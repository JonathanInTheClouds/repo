import React from "react";
import { Link } from "react-router-dom";

export default function Cancel() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        padding: "40px 16px",
      }}
    >
      <div
        style={{
          maxWidth: 720,
          width: "100%",
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 14,
          padding: 20,
          color: "#e2e8f0",
          boxShadow: "0 12px 40px rgba(0,0,0,.35)",
        }}
      >
        <h1 style={{ fontWeight: 800, fontSize: 24, margin: "0 0 6px" }}>
          Checkout canceled
        </h1>
        <p style={{ color: "#94a3b8", margin: 0 }}>
          No charge was made. You can try again anytime.
        </p>
        <div style={{ marginTop: 12 }}>
          <Link
            to="/support"
            style={{
              display: "inline-block",
              marginTop: 16,
              background: "#0b1629",
              color: "#e2e8f0",
              fontWeight: 700,
              border: "1px solid #334155",
              borderRadius: 10,
              padding: "10px 14px",
              textDecoration: "none",
            }}
          >
            Return to Support
          </Link>
        </div>
        <div style={{ marginTop: 12 }}>
          <Link to="/" style={{ color: "#94a3b8" }}>
            Back to Canvas →
          </Link>
        </div>
      </div>
    </div>
  );
}
