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

// ---------- app & io ----------
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: process.env.CORS_ORIGIN || "*" },
});
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

// ---------- stripe ----------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// ---------- grid ----------
const GRID_COLUMNS = 200;
const GRID_ROWS = 200;
const centsPerCell = Number(process.env.CENTS_PER_CELL || 2500); // $25 default

const nowTs = () => Date.now();

/* ============================
   WEBHOOK (must be FIRST; RAW)
   ============================ */
app.post(
  "/stripe/webhook",
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
      // idempotency using DB
      const firstTime = await tryInsertEvent(event.id);
      if (!firstTime) {
        return res.json({ received: true, deduped: true });
      }

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

          // Allocate atomically in DB
          const cells = await allocateCellsForEventAtomic(
            cellsToReveal,
            GRID_COLUMNS,
            GRID_ROWS,
            event.id
          );

          // Record donation meta
          await recordDonation({
            eventId: event.id,
            amountCents,
            message,
            cells: cells.length,
          });

          // Emit to clients
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
          // ignore other events
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

// ---------- REST ----------
// Create a Checkout Session with dynamic amount + metadata (message)
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { amount, currency = "usd", message = "" } = req.body || {};
    if (!Number.isFinite(amount) || amount < 100) {
      return res
        .status(400)
        .json({ error: "amount must be >= 100 (in cents)" });
    }

    const success = `${
      process.env.FRONTEND_ORIGIN || "http://localhost:3000"
    }/success`;
    const cancel = `${
      process.env.FRONTEND_ORIGIN || "http://localhost:3000"
    }/cancel`;

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

// current state for late joiners (from DB)
app.get("/state", async (_req, res) => {
  try {
    const cells = await getAllCells();
    res.json({ cells });
  } catch (e) {
    console.error("GET /state error:", e);
    res.status(500).json({ error: "failed to load state" });
  }
});

// --- simulation helpers (DB-backed) ---
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

// Simulate a single purchase
app.post("/simulate/purchase", async (req, res) => {
  try {
    const { amountCents = 2500, message = "" } = req.body || {};
    const cells = await allocateByAmount(amountCents, message);
    res.json({ ok: true, allocated: cells.length });
  } catch (e) {
    console.error("simulate/purchase error", e);
    res.status(500).json({ ok: false, error: "simulate purchase failed" });
  }
});

// Simulate a batch of purchases
app.post("/simulate/batch", async (req, res) => {
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

// ---------- sockets ----------
io.on("connection", async (socket) => {
  try {
    const cells = await getAllCells();
    socket.emit("bootstrap", { cells });
  } catch (e) {
    console.error("socket bootstrap error:", e);
  }
});

// ---------- start ----------
const port = process.env.PORT || 3001;
server.listen(port, () => {
  console.log(`API listening on :${port}`);
});
