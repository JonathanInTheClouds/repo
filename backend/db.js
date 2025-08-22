// db.js
import pkg from "pg";
import { parse as parsePgUrl } from "pg-connection-string";
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("Missing DATABASE_URL env var");

// Parse the URL so we can override SSL reliably.
// We always enable TLS in DO and, by default, skip CA verification.
// You can flip DB_SSL=0 to turn SSL off (not recommended in DO).
const cfg = parsePgUrl(DATABASE_URL);

// Want SSL?
const wantSSL =
  (process.env.DB_SSL ?? "1") !== "0" &&
  (process.env.PGSSLMODE ?? "").toLowerCase() !== "disable";

const sslConfig = !wantSSL
  ? false
  : // If explicitly asked for verify, you can mount a CA and set rejectUnauthorized:true
  (process.env.PGSSLMODE ?? "").toLowerCase() === "verify-full"
  ? { rejectUnauthorized: true }
  : // default / no-verify path that fixes "self-signed certificate in chain"
    { rejectUnauthorized: false };

export const pool = new Pool({
  host: cfg.host,
  port: cfg.port ? Number(cfg.port) : undefined,
  database: cfg.database,
  user: cfg.user,
  password: cfg.password,
  ssl: sslConfig,
  // optional: tune pool if you want
  // max: 10, idleTimeoutMillis: 10_000
});

// Auto-init schema
await pool.query(`
CREATE TABLE IF NOT EXISTS revealed (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (x, y)
);
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS donations (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  message TEXT,
  cells_allocated INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cell_allocations (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (x, y),
  FOREIGN KEY (x, y) REFERENCES revealed(x, y) ON DELETE CASCADE
);
`);

/* ---------- helpers (unchanged) ---------- */
export async function getAllCells() {
  const { rows } = await pool.query(`SELECT x, y FROM revealed ORDER BY x, y`);
  return rows;
}
export async function tryInsertEvent(eventId) {
  const { rowCount } = await pool.query(
    `INSERT INTO processed_events(event_id) VALUES ($1)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId]
  );
  return rowCount === 1;
}
export async function recordDonation({ eventId, amountCents, message, cells }) {
  await pool.query(
    `INSERT INTO donations(event_id, amount_cents, message, cells_allocated)
     VALUES ($1,$2,$3,$4)`,
    [eventId, amountCents, message || "", cells]
  );
}
export async function allocateCellsForEventAtomic(qty, gridW, gridH, eventId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const allocated = [];
    let attempts = 0;

    const neighborsOf = (x, y) =>
      [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ].filter(([a, b]) => a >= 0 && b >= 0 && a < gridW && b < gridH);

    while (allocated.length < qty && attempts < gridW * gridH * 2) {
      attempts++;
      const sx = Math.floor(Math.random() * gridW);
      const sy = Math.floor(Math.random() * gridH);
      const q = [[sx, sy]];
      const seen = new Set();

      while (q.length && allocated.length < qty) {
        const [x, y] = q.shift();
        const k = `${x},${y}`;
        if (seen.has(k)) continue;
        seen.add(k);

        const ins = await client.query(
          `INSERT INTO revealed(x,y) VALUES ($1,$2)
           ON CONFLICT (x,y) DO NOTHING
           RETURNING x,y`,
          [x, y]
        );
        if (ins.rowCount === 1) {
          allocated.push({ x, y });
          await client.query(
            `INSERT INTO cell_allocations(x,y,event_id) VALUES ($1,$2,$3)
             ON CONFLICT (x,y) DO NOTHING`,
            [x, y, eventId]
          );
        }
        for (const [nx, ny] of neighborsOf(x, y)) q.push([nx, ny]);
      }
    }

    await client.query("COMMIT");
    return allocated;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function getCellDetails(x, y) {
  const { rows } = await pool.query(
    `
    SELECT r.x, r.y, r.created_at AS revealed_at,
           ca.event_id, d.amount_cents, d.message, d.cells_allocated,
           d.created_at AS donation_at
    FROM revealed r
    LEFT JOIN cell_allocations ca ON ca.x = r.x AND ca.y = r.y
    LEFT JOIN donations d ON d.event_id = ca.event_id
    WHERE r.x = $1 AND r.y = $2
    `,
    [x, y]
  );
  return rows[0] || null;
}
export default pool;
