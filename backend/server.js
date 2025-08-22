// server.js
import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import bodyParser from "body-parser";
import cors from "cors";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

import {
  getAllCells,
  tryInsertEvent,
  recordDonation,
  allocateCellsForEventAtomic,
} from "./db.js";

// ---- config ----
const BASE_PATH = process.env.BASE_PATH || ""; // "" locally, "/repo-backend" on DO
const GRID_COLUMNS = 200;
const GRID_ROWS = 200;
const centsPerCell = Number(process.env.CENTS_PER_CELL || 2500);
const nowTs = () => Date.now();

// ---- app & io ----
const app = express();
app.set("trust proxy", true);
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  path: `${BASE_PATH}/socket.io`, // <-- critical behind proxy prefix
  cors: { origin: process.env.CORS_ORIGIN || "*" },
});

// ---- stripe ----
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

/* ======================================
   WEBHOOK (must be FIRST; RAW BODY)
   ====================================== */
app.post(
  `${BASE_PATH}/stripe/webhook`,
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    let event;
    try {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      // DB idempotency
      const firstTime = await tryInsertEvent(event.id);
      if (!firstTime) return res.json({ received: true, deduped: true });

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const amountCents = session.amount_total ?? 0;
          const message = session.metadata?.message || "";
          const cellsToReveal = Math.floor(amountCents / centsPerCell);

          if (cellsToReveal <= 0) {
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

          const cells = await allocateCellsForEventAtomic(
            cellsToReveal,
            GRID_COLUMNS,
            GRID_ROWS,
            event.id
          );

          await recordDonation({
            eventId: event.id,
            amountCents,
            message,
            cells: cells.length,
          });

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

/* ======================================
   JSON parser for the REST API (after webhook)
   ====================================== */
app.use(express.json());

// ---- REST ----
app.post(`${BASE_PATH}/create-checkout-session`, async (req, res) => {
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

app.get(`${BASE_PATH}/state`, async (_req, res) => {
  try {
    const cells = await getAllCells();
    res.json({ cells });
  } catch (e) {
    console.error("GET /state error:", e);
    res.status(500).json({ error: "failed to load state" });
  }
});

// ---- simulator (DB-backed) ----
const CENTS_PER_CELL = Number(process.env.CENTS_PER_CELL || 2500);

async function allocateByAmount(amountCents = 2500, message = "") {
  const qty = Math.floor(Number(amountCents) / CENTS_PER_CELL);
  if (qty <= 0) {
    if (message) io.emit("donation_message", { message, amountCents });
    return [];
  }
  const cells = await allocateCellsForEventAtomic(
    qty,
    GRID_COLUMNS,
    GRID_ROWS,
    `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  io.emit("cells_revealed", { cells, message, amountCents });
  return cells;
}

app.post(`${BASE_PATH}/simulate/purchase`, async (req, res) => {
  try {
    const { amountCents = 2500, message = "" } = req.body || {};
    const cells = await allocateByAmount(amountCents, message);
    res.json({ ok: true, allocated: cells.length });
  } catch (e) {
    console.error("simulate/purchase error", e);
    res.status(500).json({ ok: false, error: "simulate purchase failed" });
  }
});

app.post(`${BASE_PATH}/simulate/batch`, async (req, res) => {
  try {
    const { entries = [] } = req.body || {};
    let totalAllocated = 0;
    for (const ent of entries) {
      const amt = Number(ent.amountCents) || 0;
      const msg = ent.message || "";
      const cells = await allocateByAmount(amt, msg);
      totalAllocated += cells.length;
    }
    res.json({ ok: true, events: entries.length, totalAllocated });
  } catch (e) {
    console.error("simulate/batch error", e);
    res.status(500).json({ ok: false, error: "simulate batch failed" });
  }
});

// ---- sockets ----
io.on("connection", async (socket) => {
  try {
    const cells = await getAllCells();
    socket.emit("bootstrap", { cells });
  } catch (e) {
    console.error("socket bootstrap error:", e);
  }
});

// ---- health (helps App Platform readiness) ----
app.get("/", (_req, res) => res.status(200).send("ok"));
app.get(`${BASE_PATH}/healthz`, (_req, res) => res.status(200).send("ok"));

// ---- start ----
const port = process.env.PORT || 3001;
server.listen(port, () => {
  console.log(`API listening on :${port} (base: "${BASE_PATH}")`);
});
