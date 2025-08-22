import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import bodyParser from "body-parser";
import cors from "cors";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- app & io ----------
const app = express();
app.set("trust proxy", true); // for Fly/proxies

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: process.env.CORS_ORIGIN || "*" },
});

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// ---------- stripe ----------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// ---------- grid & state ----------
const GRID_COLUMNS = 200;
const GRID_ROWS = 200;

const centsPerCell = Number(process.env.CENTS_PER_CELL || 2500); // $25 default

// Persist in-memory: key -> { x,y, amountCents?, message?, buyer?, ts? }
const revealed = new Map(); // `${x},${y}` -> cellData
const processedEvents = new Set(); // webhook idempotency

const key = (x, y) => `${x},${y}`;
const nowTs = () => Date.now();

function allRevealedCells() {
  return [...revealed.values()];
}
function taken(x, y) {
  return revealed.has(key(x, y));
}

// naive, contiguous-ish allocator (replace w/ DB later)
function allocateCells(qty) {
  const cells = [];
  const neighborsOf = (x, y) =>
    [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ].filter(
      ([a, b]) =>
        a >= 0 && b >= 0 && a < GRID_COLUMNS && b < GRID_ROWS && !taken(a, b)
    );

  let attempts = 0;
  while (cells.length < qty && attempts < GRID_COLUMNS * GRID_ROWS) {
    attempts++;
    const sx = Math.floor(Math.random() * GRID_COLUMNS);
    const sy = Math.floor(Math.random() * GRID_ROWS);
    if (taken(sx, sy)) continue;

    const q = [[sx, sy]];
    while (q.length && cells.length < qty) {
      const [x, y] = q.shift();
      if (taken(x, y)) continue;
      const c = { x, y, ts: nowTs() };
      revealed.set(key(x, y), c);
      cells.push(c);
      for (const [nx, ny] of neighborsOf(x, y)) q.push([nx, ny]);
    }
  }
  return cells;
}

/* ============================
   WEBHOOK (must be FIRST; RAW)
   ============================ */
app.post(
  "/stripe/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (processedEvents.has(event.id)) {
      return res.json({ received: true, deduped: true });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const amountCents = session.amount_total ?? 0;
          const message = session.metadata?.message || "";
          const cellsToReveal = Math.floor(amountCents / centsPerCell);

          if (cellsToReveal <= 0) {
            processedEvents.add(event.id);
            io.emit("donation_message", {
              orderId: event.id,
              amountCents,
              message,
              ts: nowTs(),
            });
            console.log(
              `ℹ️ Message only for ${event.id} — $${(amountCents / 100).toFixed(
                2
              )}`
            );
            return res.json({ received: true });
          }

          const cells = allocateCells(cellsToReveal);

          if (cells.length > 0) {
            const first = cells[0];
            const k0 = key(first.x, first.y);
            const enriched = {
              ...revealed.get(k0),
              amountCents,
              message,
              ts: nowTs(),
            };
            revealed.set(k0, enriched);
            cells[0] = enriched;
          }

          processedEvents.add(event.id);

          io.emit("cells_revealed", {
            orderId: event.id,
            amountCents,
            message,
            cells,
          });

          console.log(
            `✅ Allocated ${cells.length} cells for event ${event.id} ($${
              amountCents / 100
            })`
          );
          break;
        }
        default:
          break;
      }

      res.json({ received: true });
    } catch (e) {
      console.error("Webhook handler error:", e);
      res.status(500).send("Webhook handler error");
    }
  }
);

/* ============================
   JSON parser for the REST API
   (after webhook only)
   ============================ */
app.use(express.json());

// health
app.get("/healthz", (_req, res) =>
  res.status(200).json({ ok: true, time: new Date().toISOString() })
);

// ---------- REST ----------
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { amount, currency = "usd", message = "" } = req.body || {};
    if (!Number.isFinite(amount) || amount < 100) {
      return res
        .status(400)
        .json({ error: "amount must be >= 100 (in cents)" });
    }

    const origin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
    const success = `${origin}/success`;
    const cancel = `${origin}/cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      metadata: { message },
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: "Million Pixel Support" },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      success_url: success,
      cancel_url: cancel,
    });

    res.json({ id: session.id, url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "create session failed" });
  }
});

app.get("/state", (_req, res) => {
  res.json({ cells: allRevealedCells() });
});

// --- simulation helpers ---
const CENTS_PER_CELL = Number(process.env.CENTS_PER_CELL || 2500);
function allocateByAmount(amountCents = 2500, message = "") {
  const qty = Math.floor(Number(amountCents) / CENTS_PER_CELL);
  if (qty <= 0) {
    if (message) io.emit("donation_message", { message, amountCents });
    return [];
  }
  const cells = allocateCells(qty);
  io.emit("cells_revealed", { cells, message, amountCents });
  return cells;
}

app.post("/simulate/purchase", (req, res) => {
  try {
    const { amountCents = 2500, message = "" } = req.body || {};
    const cells = allocateByAmount(amountCents, message);
    res.json({ ok: true, allocated: cells.length });
  } catch (e) {
    console.error("simulate/purchase error", e);
    res.status(500).json({ ok: false, error: "simulate purchase failed" });
  }
});

app.post("/simulate/batch", (req, res) => {
  try {
    const { entries = [] } = req.body || {};
    let totalAllocated = 0;
    for (const ent of entries) {
      const amt = Number(ent.amountCents) || 0;
      const msg = ent.message || "";
      const cells = allocateByAmount(amt, msg);
      totalAllocated += cells.length;
    }
    res.json({ ok: true, events: entries.length, totalAllocated });
  } catch (e) {
    console.error("simulate/batch error", e);
    res.status(500).json({ ok: false, error: "simulate batch failed" });
  }
});

// ---------- sockets ----------
io.on("connection", (socket) => {
  socket.emit("bootstrap", { cells: allRevealedCells() });
});

// ---------- serve frontend build (prod) ----------
(() => {
  const candidates = [
    path.join(__dirname, "../frontend/build"),
    path.join(__dirname, "../million-pixel-app/build"),
    path.join(__dirname, "build"),
  ];
  const frontendPath = candidates.find((p) => fs.existsSync(p));
  if (frontendPath) {
    app.use(express.static(frontendPath));
    // Express 5-safe catch-all
    app.get("/(.*)", (_req, res) => {
      res.sendFile(path.join(frontendPath, "index.html"));
    });
    console.log(`Serving frontend from: ${frontendPath}`);
  } else {
    console.log("No frontend build found — API-only mode.");
  }
})();

// ---------- start ----------
const port = process.env.PORT || 3001;
server.listen(port, () => {
  console.log(`API listening on :${port}`);
});
