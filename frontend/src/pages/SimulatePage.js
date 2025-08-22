import React, { useRef, useState } from "react";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  (import.meta?.env && import.meta.env.VITE_API_BASE) ||
  "http://localhost:3001";

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `Expected JSON but got "${ct}". Body:\n${text.slice(0, 300)}`
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function SimulatePage() {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [delayMs, setDelayMs] = useState(120); // base delay between events
  const [jitterMs, setJitterMs] = useState(80); // +/- random extra
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const cancelRef = useRef(false);

  const addLog = (line) => setLog((l) => [line, ...l].slice(0, 400));

  async function runSingle(amountCents, message) {
    setBusy(true);
    setProgress({ done: 0, total: 1, label: "Single" });
    cancelRef.current = false;
    try {
      await postJSON(`${API_BASE}/simulate/purchase`, { amountCents, message });
      addLog(`Single: $${(amountCents / 100).toFixed(2)} → 1 event sent`);
    } catch (e) {
      addLog(`Error: ${e.message}`);
      alert(e.message);
    } finally {
      setBusy(false);
      setProgress({ done: 0, total: 0, label: "" });
    }
  }

  async function runBatchSequential(entries, label = "Batch") {
    setBusy(true);
    cancelRef.current = false;
    setProgress({ done: 0, total: entries.length, label });

    try {
      let done = 0;
      for (const ent of entries) {
        if (cancelRef.current) {
          addLog(`Cancelled after ${done}/${entries.length}`);
          break;
        }
        try {
          await postJSON(`${API_BASE}/simulate/purchase`, ent);
          done += 1;
          setProgress({ done, total: entries.length, label });
          if (ent.message)
            addLog(`$${(ent.amountCents / 100).toFixed(2)} — “${ent.message}”`);
        } catch (e) {
          addLog(`Error(#${done + 1}): ${e.message}`);
        }
        const jitter =
          jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
        await sleep(delayMs + jitter);
      }
      addLog(`${label} complete: ${done}/${entries.length} events`);
    } finally {
      setBusy(false);
      setTimeout(() => setProgress({ done: 0, total: 0, label: "" }), 500);
    }
  }

  // Presets (paced)
  const do100x25 = () =>
    runBatchSequential(
      Array.from({ length: 100 }, () => ({
        amountCents: 2500,
        message: "Sim $25",
      })),
      "100 × $25 (paced)"
    );

  const do100x50 = () =>
    runBatchSequential(
      Array.from({ length: 100 }, () => ({
        amountCents: 5000,
        message: "Sim $50",
      })),
      "100 × $50 (paced)"
    );

  const do100x100 = () =>
    runBatchSequential(
      Array.from({ length: 100 }, () => ({
        amountCents: 10000,
        message: "Sim $100",
      })),
      "100 × $100 (paced)"
    );

  const doMixed300 = () => {
    const options = [
      { amountCents: 2500, message: "Sim $25" },
      { amountCents: 5000, message: "Sim $50" },
      { amountCents: 10000, message: "Sim $100" },
    ];
    const entries = Array.from(
      { length: 300 },
      () => options[Math.floor(Math.random() * options.length)]
    );
    return runBatchSequential(entries, "300 Mixed (paced)");
  };

  const cancel = () => {
    cancelRef.current = true;
  };

  return (
    <div className="simulate-wrap">
      <style>{`
        .simulate-wrap{
          min-height: 100vh;
          padding: 24px 16px 64px;
          display:flex; justify-content:center; align-items:flex-start;
          background: radial-gradient(900px 500px at 0% -10%, #1a2e4a 0%, transparent 40%),
                      radial-gradient(900px 600px at 100% 0%, #1b2d24 0%, transparent 35%),
                      #0b1220;
          color: #e2e8f0;
        }
        .panel{ width: min(1000px, 100%); display:grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .card{
          background: rgba(2,6,23,.7);
          border: 1px solid rgba(148,163,184,.25);
          border-radius: 12px; padding: 16px;
          backdrop-filter: blur(6px);
        }
        .controls{ display:grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 12px; }
        .field{ display:flex; align-items:center; gap: 8px; }
        .field input{
          width: 110px; padding: 8px 10px; border-radius: 8px; border: 1px solid #334155;
          background:#0f172a; color:#e2e8f0;
        }
        .btns{ display:flex; flex-wrap: wrap; gap: 8px; }
        button{
          padding: 10px 14px; border-radius: 10px; border: 1px solid #334155;
          background: #111827; color: #e2e8f0; cursor: pointer;
        }
        button:disabled{ opacity:.5; cursor:not-allowed; }
        .cta{ background: #16a34a; border-color: #16a34a; color: white; }
        .danger{ background: #dc2626; border-color: #dc2626; color: white; }
        .log{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
              font-size: 12px; line-height: 1.4; max-height: 360px; overflow:auto; }
        .row{ padding: 6px 0; border-bottom: 1px dashed rgba(148,163,184,.2); }
        .progress{ display:flex; align-items:center; gap: 10px; margin-top: 8px; }
        .bar{ flex:1; height: 8px; background:#0f172a; border:1px solid #334155; border-radius: 999px; overflow: hidden; }
        .fill{ height:100%; background:#16a34a; width:0%; }
      `}</style>

      <div className="panel">
        <div className="card">
          <h3>Simulate Purchases (paced)</h3>

          <div className="controls">
            <div className="field">
              <label>Delay (ms)</label>
              <input
                type="number"
                min="0"
                step="10"
                value={delayMs}
                onChange={(e) =>
                  setDelayMs(Math.max(0, Number(e.target.value) || 0))
                }
              />
            </div>
            <div className="field">
              <label>Jitter (ms)</label>
              <input
                type="number"
                min="0"
                step="10"
                value={jitterMs}
                onChange={(e) =>
                  setJitterMs(Math.max(0, Number(e.target.value) || 0))
                }
              />
            </div>
          </div>

          <div className="btns" style={{ marginBottom: 12 }}>
            <button disabled={busy} onClick={() => runSingle(2500, "Sim $25")}>
              Single $25
            </button>
            <button disabled={busy} onClick={() => runSingle(5000, "Sim $50")}>
              Single $50
            </button>
            <button
              disabled={busy}
              onClick={() => runSingle(10000, "Sim $100")}
            >
              Single $100
            </button>
          </div>

          <h4 style={{ marginTop: 8 }}>Batches (sequential with delay)</h4>
          <div className="btns">
            <button disabled={busy} onClick={do100x25}>
              100 × $25
            </button>
            <button disabled={busy} onClick={do100x50}>
              100 × $50
            </button>
            <button disabled={busy} onClick={do100x100}>
              100 × $100
            </button>
            <button disabled={busy} className="cta" onClick={doMixed300}>
              300 Mixed
            </button>
            <button disabled={!busy} className="danger" onClick={cancel}>
              Stop
            </button>
          </div>

          {progress.total > 0 && (
            <div className="progress">
              <div style={{ minWidth: 120 }}>
                {progress.label}: {progress.done}/{progress.total}
              </div>
              <div className="bar">
                <div
                  className="fill"
                  style={{
                    width: `${Math.round(
                      (progress.done / progress.total) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Log</h3>
          <div className="log" role="log" aria-live="polite">
            {log.map((line, i) => (
              <div className="row" key={i}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
