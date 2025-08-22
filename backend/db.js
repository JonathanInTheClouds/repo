import Database from "better-sqlite3";

const db = new Database(process.env.DB_FILE || "data.sqlite");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
CREATE TABLE IF NOT EXISTS revealed (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (x, y)
);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  message TEXT,
  cells_allocated INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Map each revealed cell to the event that allocated it */
CREATE TABLE IF NOT EXISTS cell_allocations (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (x, y),
  FOREIGN KEY (x, y) REFERENCES revealed(x, y) ON DELETE CASCADE
);
`);

export function getAllCells() {
  return db.prepare("SELECT x, y FROM revealed").all();
}

export function tryInsertEvent(eventId) {
  const info = db
    .prepare("INSERT OR IGNORE INTO processed_events(event_id) VALUES (?)")
    .run(eventId);
  return info.changes === 1;
}

export function recordDonation({ eventId, amountCents, message, cells }) {
  db.prepare(
    "INSERT INTO donations(event_id, amount_cents, message, cells_allocated) VALUES (?,?,?,?)"
  ).run(eventId, amountCents, message || "", cells);
}

/**
 * Atomically allocate `qty` unique cells and associate them to `eventId`.
 * Returns array of {x,y}.
 */
export function allocateCellsForEventAtomic(qty, gridW, gridH, eventId) {
  const insertCell = db.prepare(
    "INSERT OR IGNORE INTO revealed(x,y) VALUES (?,?)"
  );
  const mapAlloc = db.prepare(
    "INSERT OR IGNORE INTO cell_allocations(x,y,event_id) VALUES (?,?,?)"
  );

  const txn = db.transaction((qty) => {
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

        const info = insertCell.run(x, y);
        if (info.changes === 1) {
          allocated.push({ x, y });
          mapAlloc.run(x, y, eventId);
        }
        for (const [nx, ny] of neighborsOf(x, y)) q.push([nx, ny]);
      }
    }
    return allocated;
  });

  return txn(qty);
}

/** Return details for a cell, or null if not revealed */
export function getCellDetails(x, y) {
  return db
    .prepare(
      `
      SELECT
        r.x, r.y,
        r.created_at AS revealed_at,
        ca.event_id,
        d.amount_cents,
        d.message,
        d.cells_allocated,
        d.created_at AS donation_at
      FROM revealed r
      LEFT JOIN cell_allocations ca ON ca.x = r.x AND ca.y = r.y
      LEFT JOIN donations d ON d.event_id = ca.event_id
      WHERE r.x = ? AND r.y = ?
      `
    )
    .get(x, y);
}

export default db;
