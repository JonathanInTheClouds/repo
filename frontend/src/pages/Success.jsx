import React from "react";
import { Link } from "react-router-dom";

export default function Success() {
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
        role="status"
        aria-live="polite"
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
          Payment successful 🎉
        </h1>
        <p style={{ color: "#94a3b8", margin: 0 }}>
          Thank you! Your purchase will appear on the canvas shortly.
        </p>
        <div style={{ marginTop: 12 }}>
          <Link
            to="/"
            style={{
              display: "inline-block",
              marginTop: 16,
              background: "#16a34a",
              color: "white",
              fontWeight: 700,
              borderRadius: 10,
              padding: "10px 14px",
              textDecoration: "none",
            }}
          >
            Back to Canvas
          </Link>
        </div>
        <div style={{ marginTop: 12 }}>
          <Link to="/support" style={{ color: "#94a3b8" }}>
            Make another contribution →
          </Link>
        </div>
      </div>
    </div>
  );
}
