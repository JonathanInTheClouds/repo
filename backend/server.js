// server.js
import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import bodyParser from "body-parser";
import cors from "cors";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

// import {
//   getAllCells,
//   tryInsertEvent,
//   recordDonation,
//   allocateCellsForEventAtomic,
// } from "./db.js";

import {
  getAllCellsWithMeta,
  tryInsertEvent,
  recordDonation,
  allocateCellsForEventAtomic,
} from "./db.js";

/* ---------- config ---------- */
const BASE_PATH = (process.env.BASE_PATH || "/").replace(/\/+$/, "") || "/";
const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || "/socket.io";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const GRID_COLUMNS = 200;
const GRID_ROWS = 200;
const centsPerCell = Number(process.env.CENTS_PER_CELL || 2500); // $25 default
const CENTS_PER_CELL = centsPerCell;

/* ---------- app & io ---------- */
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  path: SOCKET_IO_PATH,
  cors: { origin: CORS_ORIGIN },
});
app.use(cors({ origin: CORS_ORIGIN }));

/* health at BOTH prefixed and root for sanity */
app.get(["/healthz", `${BASE_PATH}/healthz`], (_req, res) =>
  res.json({
    ok: true,
    basePath: BASE_PATH,
    socketPath: SOCKET_IO_PATH,
    time: new Date().toISOString(),
  })
);

/* ---------- stripe ---------- */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const nowTs = () => Date.now();

/* =========================================================
   Router (mounted at BOTH "/" and BASE_PATH)
   ========================================================= */
const router = express.Router();

/* WEBHOOK must use raw body (before json) */
router.post(
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
            // Persist the message-only donation for audit/history
            await recordDonation({
              eventId: event.id,
              amountCents,
              message,
              cells: 0, // no cells allocated
            });

            // Tell clients to show a bubble, but don't allocate any cells
            io.emit("donation_message", {
              orderId: event.id,
              amountCents,
              message, // can be empty; frontend falls back to "Thank You!"
              ts: nowTs(),
            });

            console.log(
              `ℹ️ Message-only donation for ${event.id} — $${(
                amountCents / 100
              ).toFixed(2)}`
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
          break;
      }

      res.json({ received: true });
    } catch (e) {
      console.error("Webhook handler error:", e);
      res.status(500).send("Webhook handler error");
    }
  }
);

/* JSON parser for the REST API (AFTER webhook only) */
router.use(express.json());

/* ---------- REST ---------- */
router.post("/create-checkout-session", async (req, res) => {
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

// router.get("/state", async (_req, res) => {
//   try {
//     const cells = await getAllCells();
//     res.json({ cells });
//   } catch (e) {
//     console.error("GET /state error:", e);
//     res.status(500).json({ error: "failed to load state" });
//   }
// });

router.get("/state", async (_req, res) => {
  try {
    const cells = await getAllCellsWithMeta();
    res.json({ cells });
  } catch (e) {
    console.error("GET /state error:", e);
    res.status(500).json({ error: "failed to load state" });
  }
});

/* --- simulation helpers --- */
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

router.post("/simulate/purchase", async (req, res) => {
  try {
    const { amountCents = 2500, message = "" } = req.body || {};
    const cells = await allocateByAmount(amountCents, message);
    res.json({ ok: true, allocated: cells.length });
  } catch (e) {
    console.error("simulate/purchase error", e);
    res.status(500).json({ ok: false, error: "simulate purchase failed" });
  }
});

router.post("/simulate/batch", async (req, res) => {
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

/* ---------- mount router at BOTH paths ---------- */
app.use(BASE_PATH, router);
if (BASE_PATH !== "/") {
  app.use("/", router);
}

/* ---------- sockets ---------- */
// io.on("connection", async (socket) => {
//   try {
//     const cells = await getAllCells();
//     socket.emit("bootstrap", { cells });
//   } catch (e) {
//     console.error("socket bootstrap error:", e);
//   }
// });
// socket bootstrap
io.on("connection", async (socket) => {
  try {
    const cells = await getAllCellsWithMeta();
    socket.emit("bootstrap", { cells });
  } catch (e) {
    console.error("socket bootstrap error:", e);
  }
});

/* ---------- start ---------- */
const port = process.env.PORT || 3001;
server.listen(port, () => {
  console.log(
    `API listening on :${port} (base: "${BASE_PATH}", socket path: "${SOCKET_IO_PATH}")`
  );
});
