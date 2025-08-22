// src/pages/Cancel.jsx
import React from "react";
import { Link } from "react-router-dom";

export default function Cancel() {
  return (
    <div className="page-wrap">
      <style>{`
        .page-wrap{min-height:60vh;display:grid;place-items:center;padding:40px 16px}
        .card{max-width:720px;width:100%;background:#0f172a;border:1px solid #334155;border-radius:14px;padding:20px;color:#e2e8f0;box-shadow:0 12px 40px rgba(0,0,0,.35)}
        .title{font-weight:800;font-size:24px;margin:0 0 6px}
        .muted{color:#94a3b8}
        .row{margin-top:12px}
        .cta{display:inline-block;margin-top:16px;background:#0b1629;color:#e2e8f0;font-weight:700;border:1px solid #334155;border-radius:10px;padding:10px 14px;text-decoration:none}
      `}</style>
      <div className="card">
        <h1 className="title">Checkout canceled</h1>
        <p className="muted">
          No worries—your card wasn’t charged. You can try again anytime.
        </p>
        <div className="row">
          <Link className="cta" to="/support">
            Return to Support
          </Link>
        </div>
        <div className="row">
          <Link className="muted" to="/">
            Back to Canvas →
          </Link>
        </div>
      </div>
    </div>
  );
}
