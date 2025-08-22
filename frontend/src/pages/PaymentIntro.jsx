import React, { useMemo, useState } from "react";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  (import.meta?.env && import.meta.env.VITE_API_BASE) ||
  "http://localhost:3001";

/** UI-only constant. Backend enforces with CENTS_PER_CELL. */
const CENTS_PER_CELL = Number(
  (import.meta?.env && import.meta.env.VITE_CENTS_PER_CELL) ||
    process.env.REACT_APP_CENTS_PER_CELL ||
    2500 // $25 per cell
);

/** Presets use the amount-based endpoint (no Stripe Price IDs needed). */
const PRESETS = [
  { label: "$25", amountCents: 2500 },
  { label: "$50", amountCents: 5000 },
  { label: "$100", amountCents: 10000 },
  { label: "$250", amountCents: 25000 },
];

/* ---- tiny visual preview of cell count ---- */
function CellsPreview({ count }) {
  const n = Math.min(count, 60);
  return (
    <div className="cells-prev" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} />
      ))}
      {count > n && <span className="more">+{count - n}</span>}
    </div>
  );
}

export default function PaymentIntro() {
  const [mode, setMode] = useState("preset"); // 'preset' | 'custom'
  const [selected, setSelected] = useState(PRESETS[0].amountCents);
  const [customAmount, setCustomAmount] = useState("25");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const amountCents =
    mode === "preset"
      ? selected
      : Math.max(0, Math.round((Number(customAmount) || 0) * 100));

  const cells = useMemo(
    () => Math.floor(amountCents / CENTS_PER_CELL),
    [amountCents]
  );

  async function startCheckout(e) {
    e.preventDefault();
    setErr("");
    if (amountCents < 100) {
      setErr("Minimum is $1.00.");
      return;
    }
    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE}/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountCents,
          currency: "usd",
          message,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start checkout");
      window.location.href = data.url;
    } catch (e) {
      setErr(e.message);
      setSubmitting(false);
    }
  }

  function pickPreset(cents) {
    setSelected(cents);
    setMode("preset");
  }

  function step(delta) {
    const v = Math.max(1, Math.round((Number(customAmount) || 0) + delta));
    setCustomAmount(String(v));
  }

  return (
    <div className="support-wrap">
      <Style />

      {/* NEW: stack header+card so they can center together */}
      <div className="stack">
        <header className="support-header">
          <h1>Support the Reveal</h1>
          <p>Every dollar helps highlight the image. $25 reveals one cell.</p>
        </header>

        <div className="card">
          <div className="seg" role="tablist" aria-label="Amount mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "preset"}
              className={`seg-btn ${mode === "preset" ? "active" : ""}`}
              onClick={() => setMode("preset")}
            >
              Presets
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "custom"}
              className={`seg-btn ${mode === "custom" ? "active" : ""}`}
              onClick={() => setMode("custom")}
            >
              Custom
            </button>
          </div>

          {mode === "preset" ? (
            <div className="grid">
              {PRESETS.map((p) => {
                const c = Math.floor(p.amountCents / CENTS_PER_CELL);
                const isActive = selected === p.amountCents;
                return (
                  <button
                    key={p.amountCents}
                    type="button"
                    className={`tile ${isActive ? "tile-active" : ""}`}
                    onClick={() => pickPreset(p.amountCents)}
                    disabled={submitting}
                  >
                    {isActive && <span className="tick">✓</span>}
                    <div className="tile-amount">{p.label}</div>
                    <div className="tile-sub">
                      +{c} {c === 1 ? "cell" : "cells"}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="custom">
              <label className="field">
                <span className="field-label">Amount (USD)</span>
                <div className="number">
                  <button
                    type="button"
                    className="steppy"
                    onClick={() => step(-5)}
                    disabled={submitting}
                    aria-label="minus 5"
                  >
                    −5
                  </button>
                  <button
                    type="button"
                    className="steppy"
                    onClick={() => step(-1)}
                    disabled={submitting}
                    aria-label="minus 1"
                  >
                    −1
                  </button>
                  <input
                    className="num-input"
                    type="number"
                    min="1"
                    step="1"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    disabled={submitting}
                    inputMode="decimal"
                  />
                  <button
                    type="button"
                    className="steppy"
                    onClick={() => step(1)}
                    disabled={submitting}
                    aria-label="plus 1"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    className="steppy"
                    onClick={() => step(5)}
                    disabled={submitting}
                    aria-label="plus 5"
                  >
                    +5
                  </button>
                </div>
              </label>

              <div className="hint">
                Estimated: <b>+{cells}</b> {cells === 1 ? "cell" : "cells"} ( $
                {CENTS_PER_CELL / 100} per cell)
              </div>
            </div>
          )}

          <label className="field" style={{ marginTop: 14 }}>
            <span className="field-label">Message (optional)</span>
            <textarea
              rows={4}
              maxLength={500}
              placeholder="Say something to be recorded with your purchase…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={submitting}
            />
            <div className="count">{message.length}/500</div>
          </label>

          <div className="bar">
            <div className="mini">
              <span className="muted">You’ll be charged</span>
              <div className="total">
                ${(amountCents / 100).toFixed(2)}
                {cells > 0 && (
                  <span className="cells">
                    {" "}
                    (+{cells} {cells === 1 ? "cell" : "cells"})
                  </span>
                )}
              </div>
              {cells > 0 && <CellsPreview count={cells} />}
              <div className="footnote">Minimum $1. Message always saved.</div>
            </div>

            <button
              className="cta"
              onClick={startCheckout}
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? "Redirecting…" : "Continue to Checkout"}
            </button>
          </div>

          {err && <div className="error">{err}</div>}
        </div>
      </div>
    </div>
  );
}

/* -------- styles (scoped) -------- */
function Style() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');

:root{
  --bg: #0b1220;
  --card: #0f172a;
  --muted: #94a3b8;
  --line: #334155;
  --text: #e2e8f0;
  --brand: #16a34a;
  --brand-2: #15803d;
  --pill: #111827;
  --tile: #111827;
  --tile-hover: #0b1220;
  --shadow: 0 12px 40px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.2);
}

.support-wrap{
  min-height: 100vh;
  color: var(--text);
  background: radial-gradient(1000px 600px at 20% -10%, #19324b 0%, transparent 40%),
              radial-gradient(800px 500px at 100% 0%, #1b2d24 0%, transparent 35%),
              var(--bg);
  padding: 24px 16px 48px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
}

/* NEW: group header + card so they center together on tall screens */
.stack{
  max-width: 860px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
@media (min-height: 820px){
  .stack{
    min-height: calc(100vh - 96px); /* leave some breathing room */
    justify-content: center;        /* vertical centering of the group */
  }
}

.support-header h1{
  margin: 0 0 6px;
  font-size: 28px;
  letter-spacing: .2px;
}
.support-header p{
  margin: 0;
  color: var(--muted);
}

.card{
  background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));
  border: 1px solid rgba(51,65,85,.85);
  border-radius: 16px;
  box-shadow: var(--shadow);
  padding: 18px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.seg{
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 4px;
  background: var(--pill);
  margin-bottom: 14px;
}
.seg-btn{
  appearance: none;
  background: transparent;
  color: var(--text);
  border: none;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}
.seg-btn.active{
  background: #0b1629;
  outline: 1px solid var(--line);
}

.grid{
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.tile{
  position: relative; /* for tick */
  text-align: left;
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  transition: transform .06s ease, background .12s ease;
}
.tile:hover{ background: var(--tile-hover); transform: translateY(-2px) scale(1.01); }
.tile:focus-visible{ outline: 2px solid var(--brand); outline-offset: 2px; }
.tile-active{ outline: 2px solid var(--brand); }
.tile-amount{ font-size: 18px; font-weight: 700; }
.tile-sub{ margin-top: 6px; color: var(--muted); font-size: 13px; }

.tick{
  position: absolute;
  top: 10px; right: 10px;
  width: 22px; height: 22px; line-height: 22px;
  border-radius: 999px;
  background: var(--brand);
  color: white; font-weight: 800; font-size: 12px;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 10px rgba(22,163,74,.35);
}

.custom{ margin-top: 6px; }
.field{ display: block; }
.field + .field{ margin-top: 12px; }
.field-label{ display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }

/* FIX: make inputs/textarea respect container width */
*, *::before, *::after { box-sizing: border-box; }

.number{
  display: flex; align-items: center; gap: 8px;
  background: var(--pill); border: 1px solid var(--line); border-radius: 12px; padding: 8px;
}
.num-input{
  inline-size: 120px;
  background: #0b1220; color: var(--text);
  border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 12px; font-size: 16px;
}

.steppy{
  background: #0b1629; color: var(--text);
  border: 1px solid var(--line); border-radius: 8px;
  padding: 8px 10px; cursor: pointer; font-weight: 700; min-width: 44px;
}

textarea{
  width: 100%; resize: vertical;
  background: #0b1220; color: var(--text);
  border: 1px solid var(--line); border-radius: 12px;
  padding: 10px 12px; font-size: 14px; line-height: 1.35;
  box-sizing: border-box; /* <-- critical: prevents right overflow */
}
.count{ text-align: right; color: var(--muted); font-size: 12px; margin-top: 4px; }

.hint{
  margin-top: 8px; color: var(--muted); font-size: 13px;
}

.bar{
  margin-top: 16px; display: flex; gap: 12px; align-items: center; justify-content: space-between;
  border-top: 1px dashed var(--line); padding-top: 12px;
}
.mini .muted{ color: var(--muted); font-size: 12px; }
.total{ font-weight: 800; font-size: 18px; letter-spacing: .2px; }
.cells{ color: var(--brand); font-weight: 700; margin-left: 4px; }

.cells-prev{
  margin-top: 6px;
  display: flex; flex-wrap: wrap; gap: 4px;
  max-width: 360px;
}
.cells-prev span{
  width: 8px; height: 8px; border-radius: 2px;
  background: linear-gradient(180deg, #24d069, #16a34a);
  box-shadow: 0 1px 2px rgba(0,0,0,.25);
}
.cells-prev .more{
  margin-left: 6px; color: var(--muted); font-size: 12px;
  align-self: center;
}

.footnote{ color: var(--muted); font-size: 12px; margin-top: 6px; }

.cta{
  appearance: none; border: none; cursor: pointer;
  background: var(--brand); color: white; font-weight: 700;
  padding: 12px 16px; border-radius: 12px; min-width: 220px;
  box-shadow: 0 6px 24px rgba(22,163,74,.25);
  transition: transform .06s ease, box-shadow .12s ease, opacity .12s ease;
}
.cta:hover{ transform: translateY(-1px); box-shadow: 0 10px 30px rgba(22,163,74,.35); }
.cta:active{ transform: translateY(0); box-shadow: 0 6px 18px rgba(22,163,74,.28); }
.cta[aria-busy="true"]{ opacity: .75; cursor: default; }

.error{
  margin-top: 12px; padding: 10px 12px;
  background: rgba(220,38,38, .12); border: 1px solid #7f1d1d; color: #fecaca;
  border-radius: 10px; font-size: 13px;
}

@media (max-width: 560px){
  .cta{ min-width: 140px; width: 100%; }
  .bar{ flex-direction: column; align-items: stretch; }
}

/* ensure buttons inherit our light text color */
button { color: inherit; font: inherit; }

/* tiles explicitly use the light text */
.tile { color: var(--text); }
.tile-amount { color: var(--text); }
.tile-sub { color: var(--muted); }

      `}</style>
  );
}
