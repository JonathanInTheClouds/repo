import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import imageSrc from "../Banner Hi Rez.png";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  (import.meta?.env && import.meta.env.VITE_API_BASE) ||
  "http://localhost:3001";

const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:3001");

const SOCKET_PATH =
  process.env.REACT_APP_SOCKET_PATH ||
  (API_BASE.includes("/repo-backend")
    ? "/repo-backend/socket.io"
    : "/socket.io");

const socket = io(SOCKET_URL, {
  path: SOCKET_PATH,
  transports: ["websocket"],
  autoConnect: true,
});

const CANVAS_WIDTH = 1495;
const CANVAS_HEIGHT = 1024;
const GRID_COLUMNS = 200;
const GRID_ROWS = 200;
const CELL_WIDTH = CANVAS_WIDTH / GRID_COLUMNS;
const CELL_HEIGHT = CANVAS_HEIGHT / GRID_ROWS;

const pulseDurationMs = 4500;

/* persistent tint */
const DESIRED_TINT = "#f59e0b";
const TINT_ALPHA = 0.65;
const TINT_PERSIST_MS = 0; // 0=infinite
const TINT_INSET = 1;
const TINT_RADIUS = 2;

let cachedGrayCanvas = null;
function buildGrayBase(img) {
  if (cachedGrayCanvas) return cachedGrayCanvas;
  const off = document.createElement("canvas");
  off.width = CANVAS_WIDTH;
  off.height = CANVAS_HEIGHT;
  const octx = off.getContext("2d");
  octx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const data = octx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const a = data.data;
  for (let i = 0; i < a.length; i += 4) {
    const avg = (a[i] + a[i + 1] + a[i + 2]) / 3;
    a[i] = avg;
    a[i + 1] = avg;
    a[i + 2] = avg;
  }
  octx.putImageData(data, 0, 0);
  cachedGrayCanvas = off;
  return off;
}

const k = (x, y) => `${x},${y}`;

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export default function CanvasPage() {
  const canvasRef = useRef(null);

  // logical state (for hover/metadata); never used to "erase" pixels
  const [cells, setCells] = useState([]); // [{x,y,amountCents?,message?,ts?}]
  const cellsMapRef = useRef(new Map()); // k -> cell

  // image + layers
  const imgRef = useRef(null);
  const [imgReady, setImgReady] = useState(false);
  const tilesCanvasRef = useRef(null); // offscreen layer with colored tiles
  const tilesCtxRef = useRef(null);
  const tilesKeysRef = useRef(new Set()); // keys already drawn to offscreen
  const pendingDrawQueueRef = useRef([]); // queue cells until image is ready

  // hover
  const [hover, setHover] = useState(null);

  // effects
  const pulsesRef = useRef(new Map()); // k -> t0
  const tintsRef = useRef(new Map()); // k -> {color, t0}
  const rafRef = useRef(0);

  // UI bubble
  const bubbleTimerRef = useRef(null);
  const [bubble, setBubble] = useState(null);

  // reconcile burst
  const reconcileTimersRef = useRef([]);

  // NEW: grouping for messages across all cells of a purchase
  const cellToGroupRef = useRef(new Map()); // k -> groupId
  const groupMetaRef = useRef(new Map()); // groupId -> { message, amountCents }

  const totalCells = GRID_COLUMNS * GRID_ROWS;

  /* image */
  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      imgRef.current = img;
      buildGrayBase(img);
      ensureOffscreen();
      flushPendingToOffscreen();
      setImgReady(true);
      draw();
    };
  }, []);

  function ensureOffscreen() {
    if (!tilesCanvasRef.current) {
      const off = document.createElement("canvas");
      off.width = CANVAS_WIDTH;
      off.height = CANVAS_HEIGHT;
      tilesCanvasRef.current = off;
      tilesCtxRef.current = off.getContext("2d");
    }
  }

  function blitCellsToOffscreen(cellsArr) {
    const img = imgRef.current;
    const ctx = tilesCtxRef.current;
    if (!img || !ctx) {
      // queue until ready
      pendingDrawQueueRef.current.push(...cellsArr);
      return;
    }
    for (const { x, y } of cellsArr) {
      const kk = k(x, y);
      if (tilesKeysRef.current.has(kk)) continue;
      tilesKeysRef.current.add(kk);
      ctx.drawImage(
        img,
        x * CELL_WIDTH,
        y * CELL_HEIGHT,
        CELL_WIDTH,
        CELL_HEIGHT,
        x * CELL_WIDTH,
        y * CELL_HEIGHT,
        CELL_WIDTH,
        CELL_HEIGHT
      );
    }
  }

  function flushPendingToOffscreen() {
    if (pendingDrawQueueRef.current.length) {
      const arr = pendingDrawQueueRef.current.splice(0);
      blitCellsToOffscreen(arr);
    }
  }

  /* helpers for logical state */
  const setCellsAndMap = (updater) => {
    setCells((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // monotonic guard: never shrink
      if (next.length < prev.length) return prev;
      const m = new Map();
      for (const c of next) m.set(k(c.x, c.y), c);
      cellsMapRef.current = m;
      return next;
    });
  };

  const mergeCells = (incoming) => {
    if (!incoming?.length) return;
    // compute "added" against current map (before state set)
    const newOnes = [];
    for (const c of incoming) {
      const kk = k(c.x, c.y);
      if (!cellsMapRef.current.has(kk)) newOnes.push(c);
    }
    // update logical state (union)
    setCellsAndMap((prev) => {
      const out = prev.slice();
      const have = new Set(prev.map((c) => k(c.x, c.y)));
      for (const c of incoming) {
        const kk = k(c.x, c.y);
        if (!have.has(kk)) {
          out.push(c);
          have.add(kk);
        } else {
          const idx = out.findIndex((p) => p.x === c.x && p.y === c.y);
          if (idx >= 0) out[idx] = { ...out[idx], ...c };
        }
      }
      return out;
    });
    // paint the new ones immediately to offscreen
    if (newOnes.length) blitCellsToOffscreen(newOnes);
  };

  const reconcileFromServer = async () => {
    try {
      const r = await fetch(`${API_BASE}/state`);
      const { cells: serverCells } = await r.json();
      if (!Array.isArray(serverCells)) return;
      // union into logical state
      mergeCells(serverCells);
      draw(); // immediate repaint
    } catch {
      /* ignore */
    }
  };

  const scheduleReconcileBurst = () => {
    for (const t of reconcileTimersRef.current) clearTimeout(t);
    reconcileTimersRef.current = [];
    for (const ms of [300, 1200, 3000]) {
      reconcileTimersRef.current.push(setTimeout(reconcileFromServer, ms));
    }
  };

  /* bootstrap + sockets */
  useEffect(() => {
    reconcileFromServer(); // initial union

    const onCells = (payload) => {
      const { cells, message, amountCents, orderId } = payload || {};
      // assign a group id (prefer Stripe event id)
      const gid =
        orderId ||
        `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // persist group meta (may be empty string)
      groupMetaRef.current.set(gid, { message, amountCents });

      // map every cell -> groupId
      if (Array.isArray(cells)) {
        for (const c of cells) {
          cellToGroupRef.current.set(k(c.x, c.y), gid);
        }
      }

      // also put message/amount onto each cell object (so hover works even without lookup)
      const enriched =
        Array.isArray(cells) &&
        (message !== undefined || typeof amountCents === "number")
          ? cells.map((c) => ({ ...c, message, amountCents }))
          : cells;

      // optimistic union + offscreen blit
      mergeCells(enriched);

      // visuals
      const t0 = performance.now();
      for (const c of cells || []) {
        const kk = k(c.x, c.y);
        pulsesRef.current.set(kk, t0);
        tintsRef.current.set(kk, { color: DESIRED_TINT, t0 });
      }
      kickPulse();

      // always show a bubble; fallback text handled inside
      showBubbleForCells(cells || [], message, amountCents);

      // heal any races
      scheduleReconcileBurst();
    };

    const onBootstrap = ({ cells }) => {
      // union only; never replace
      mergeCells(cells);
    };

    socket.on("bootstrap", onBootstrap);
    socket.on("cells_revealed", onCells);
    socket.on("donation_message", ({ message, amountCents, orderId }) => {
      const gid =
        orderId ||
        `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      groupMetaRef.current.set(gid, { message, amountCents });
      // always show bubble even if message is empty
      showBubbleForCells([], message, amountCents);
    });

    const iv = setInterval(reconcileFromServer, 20000);

    return () => {
      socket.off("bootstrap", onBootstrap);
      socket.off("cells_revealed", onCells);
      socket.off("donation_message");
      clearInterval(iv);
      for (const t of reconcileTimersRef.current) clearTimeout(t);
      reconcileTimersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
  }, [cells, imgReady]);

  /* draw */
  function draw(now = performance.now()) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const img = imgRef.current;
    const tiles = tilesCanvasRef.current;
    if (!canvas || !ctx || !img || !tiles) return;

    const gray = buildGrayBase(img);
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.drawImage(gray, 0, 0);

    // composite persistent tiles layer (never cleared)
    ctx.drawImage(tiles, 0, 0);

    // persistent tints
    if (tintsRef.current.size) {
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = TINT_ALPHA;
      for (const [keyStr, meta] of tintsRef.current) {
        if (TINT_PERSIST_MS > 0 && now - meta.t0 > TINT_PERSIST_MS) {
          tintsRef.current.delete(keyStr);
          continue;
        }
        const [xs, ys] = keyStr.split(",");
        const x = +xs,
          y = +ys;
        const px = x * CELL_WIDTH + TINT_INSET;
        const py = y * CELL_HEIGHT + TINT_INSET;
        const pw = CELL_WIDTH - TINT_INSET * 2;
        const ph = CELL_HEIGHT - TINT_INSET * 2;
        drawRoundedRect(ctx, px, py, pw, ph, TINT_RADIUS);
        ctx.fillStyle = meta.color || DESIRED_TINT;
        ctx.fill();
      }
      ctx.restore();
    }

    // pulse outline
    let anyAlive = false;
    pulsesRef.current.forEach((t0, keyStr) => {
      const age = now - t0;
      const life = age / pulseDurationMs;
      if (life >= 1) {
        pulsesRef.current.delete(keyStr);
        return;
      }
      anyAlive = true;
      const [xs, ys] = keyStr.split(",");
      const x = +xs,
        y = +ys;
      const alpha = 1 - life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha) * 0.95;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(34,197,94,1)";
      ctx.strokeRect(
        Math.floor(x * CELL_WIDTH) + 0.5,
        Math.floor(y * CELL_HEIGHT) + 0.5,
        Math.floor(CELL_WIDTH) - 1,
        Math.floor(CELL_HEIGHT) - 1
      );
      ctx.restore();
    });

    drawGrid(ctx);

    if (anyAlive || (TINT_PERSIST_MS > 0 && tintsRef.current.size)) {
      rafRef.current = requestAnimationFrame(draw);
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }

  function kickPulse() {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw);
  }

  function drawGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_COLUMNS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_WIDTH, 0);
      ctx.lineTo(i * CELL_WIDTH, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let j = 0; j <= GRID_ROWS; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * CELL_HEIGHT);
      ctx.lineTo(CANVAS_WIDTH, j * CELL_HEIGHT);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* hover */
  function onMouseMove(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const x = Math.floor(px / CELL_WIDTH);
    const y = Math.floor(py / CELL_HEIGHT);
    if (x < 0 || y < 0 || x >= GRID_COLUMNS || y >= GRID_ROWS) {
      setHover(null);
      return;
    }
    const keyStr = k(x, y);
    const cell = cellsMapRef.current.get(keyStr);
    if (!cell) {
      setHover(null);
      return;
    }

    // resolve message: per-cell OR group-level
    let hoverMsg = cell.message;
    let hoverAmt = cell.amountCents;
    if (!hoverMsg || typeof hoverAmt !== "number") {
      const gid = cellToGroupRef.current.get(keyStr);
      const meta = gid ? groupMetaRef.current.get(gid) : null;
      if (meta) {
        hoverMsg = hoverMsg || meta.message;
        hoverAmt = typeof hoverAmt === "number" ? hoverAmt : meta.amountCents;
      }
    }

    setHover({
      clientX: e.clientX,
      clientY: e.clientY,
      cell: { ...cell, message: hoverMsg, amountCents: hoverAmt },
    });
  }
  function onMouseLeave() {
    setHover(null);
  }

  /* bubble */
  function showBubbleForCells(cellsArr, message, amountCents) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    let left = rect.left + rect.width / 2;
    let top = rect.top + 24;

    const first = cellsArr?.[0];
    if (first) {
      left = rect.left + (first.x + 0.5) * (rect.width / GRID_COLUMNS);
      top = rect.top + (first.y + 0.5) * (rect.height / GRID_ROWS) - 8;
    }

    setBubble({
      left,
      top,
      message: message && message.trim() ? message : "Thank You!",
      amountCents,
      until: Date.now() + 9000,
    });

    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => setBubble(null), 9000);
  }

  const remaining = useMemo(
    () => Math.max(totalCells - cells.length, 0),
    [cells.length, totalCells]
  );

  return (
    <div className="canvas-wrap">
      <Style />
      <div className="canvas-shell">
        <div className="hud">
          <div className="hud-title">Million Pixel Reveal</div>
          <div className="hud-sub">Remaining: {remaining.toLocaleString()}</div>
        </div>

        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="canvas"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        />

        {hover?.cell && (
          <div
            className="tip"
            style={{ left: hover.clientX + 14, top: hover.clientY + 14 }}
          >
            <div className="tip-row">
              <b>Cell</b> ({hover.cell.x},{hover.cell.y})
            </div>
            {typeof hover.cell.amountCents === "number" && (
              <div className="tip-row">
                <b>Amount</b> ${(hover.cell.amountCents / 100).toFixed(2)}
              </div>
            )}
            {/* Always render; fallback to Thank You! */}
            <div className="tip-row msg">
              “{hover.cell.message?.trim() || "Thank You!"}”
            </div>
          </div>
        )}

        {bubble && (
          <div
            className="bubble"
            style={{ left: bubble.left, top: bubble.top }}
          >
            {typeof bubble.amountCents === "number" && (
              <div className="bubble-amt">
                ${(bubble.amountCents / 100).toFixed(2)}
              </div>
            )}
            <div className="bubble-msg">“{bubble.message}”</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* styles */
function Style() {
  return (
    <style>{`
:root{
  --bg: #0b1220;
  --line: #334155;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --hud-bg: rgba(2,6,23,.7);
}
.canvas-wrap{
  min-height: 100vh;
  background: radial-gradient(1000px 600px at 20% -10%, #19324b 0%, transparent 40%),
              radial-gradient(800px 500px at 100% 0%, #1b2d24 0%, transparent 35%),
              var(--bg);
  display: flex; justify-content: center; align-items: flex-start;
  padding: 24px 16px 64px;
}
@media (min-height: 820px){ .canvas-wrap{ align-items: center; } }
.canvas-shell{ width: min(100%, 1500px); position: relative; }
.canvas{
  display: block; width: 100%; height: auto; margin: 12px auto 0;
  border: 2px solid var(--line); border-radius: 14px;
  box-shadow: 0 14px 40px rgba(0,0,0,.35), 0 2px 10px rgba(0,0,0,.25);
  background: #0e1624;
}
.hud{
  position: absolute; top: 14px; left: 14px; z-index: 2;
  background: var(--hud-bg); color: var(--text);
  border: 1px solid rgba(148,163,184,.35);
  border-radius: 8px; padding: 10px 12px;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.hud-title{ font-weight: 800; font-size: 14px; line-height: 1.1; }
.hud-sub{ color: var(--muted); font-size: 12px; margin-top: 2px; }
.tip{
  position: fixed; z-index: 10; max-width: 320px;
  background: rgba(15,23,42,.95); color: var(--text);
  border: 1px solid rgba(51,65,85,.9); border-radius: 10px; padding: 10px 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,.35); pointer-events: none; font-size: 13px;
}
.tip-row{ margin: 2px 0; }
.tip-row.msg{ color: var(--muted); font-style: italic; }
.bubble{
  position: fixed; z-index: 11;
  transform: translate(-50%, -100%);
  background: rgba(2,6,23,.92); border: 1px solid rgba(51,65,85,.9);
  color: var(--text); border-radius: 12px; padding: 10px 12px;
  box-shadow: 0 12px 36px rgba(0,0,0,.45);
  animation: bubble-in .2s ease-out, bubble-out .25s ease-in 8.75s forwards;
  max-width: min(70vw, 420px);
}
.bubble-amt{ font-weight: 800; margin-bottom: 2px; }
.bubble-msg{ color: var(--muted); font-style: italic; }
@keyframes bubble-in { from{ opacity: 0; transform: translate(-50%,-90%) scale(.98);} to{opacity:1; transform: translate(-50%,-100%) scale(1);} }
@keyframes bubble-out { to{ opacity: 0; transform: translate(-50%,-100%) scale(.98);} }
    `}</style>
  );
}
