import React, { useEffect, useMemo, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  NavLink,
  useNavigate,
} from "react-router-dom";
import { io } from "socket.io-client";
import CanvasPage from "./pages/CanvasPage";
import PaymentIntro from "./pages/PaymentIntro";
import SimulatePage from "./pages/SimulatePage";
import "./App.css"; // <-- nav styles live here

// -------- shared envs --------
const API_BASE =
  process.env.REACT_APP_API_BASE ||
  (import.meta?.env && import.meta.env.VITE_API_BASE) ||
  "http://localhost:3001";

// Keep in sync with your canvas
const GRID_COLUMNS = 200;
const GRID_ROWS = 200;

export default function App() {
  return (
    <Router>
      <NavBar />
      <main>
        <Routes>
          <Route path="/" element={<CanvasPage />} />
          <Route path="/support" element={<PaymentIntro />} />
          <Route path="/simulate" element={<SimulatePage />} />
        </Routes>
      </main>
    </Router>
  );
}

function NavBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);

  const totalCells = GRID_COLUMNS * GRID_ROWS;
  const remaining = useMemo(
    () => Math.max(totalCells - revealedCount, 0),
    [revealedCount, totalCells]
  );

  // bootstrap + live updates
  useEffect(() => {
    let s;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/state`);
        const { cells } = await r.json();
        setRevealedCount(Array.isArray(cells) ? cells.length : 0);
      } catch {}
      // live
      s = io(API_BASE, { transports: ["websocket"] });
      const onMerge = ({ cells }) => {
        if (!cells?.length) return;
        // increment by delta; backend emits only new cells
        setRevealedCount((n) => n + cells.length);
      };
      s.on("bootstrap", ({ cells }) =>
        setRevealedCount(Array.isArray(cells) ? cells.length : 0)
      );
      s.on("cells_revealed", onMerge);
    })();
    return () => {
      try {
        s && s.disconnect();
      } catch {}
    };
  }, []);

  function gotoSupport() {
    setOpen(false);
    navigate("/support");
  }

  return (
    <header className="nav">
      <div className="nav-inner">
        {/* left: brand */}
        <div
          className="brand"
          onClick={() => navigate("/")}
          role="button"
          tabIndex={0}
        >
          <div className="logo-dot" />
          <span className="brand-text">Million Pixel</span>
        </div>

        {/* center: links (desktop) */}
        <nav className="links">
          <Nav to="/" label="Canvas" />
          <Nav to="/support" label="Support" />
          <Nav to="/simulate" label="Simulate" />
        </nav>

        {/* right: remaining + CTA */}
        <div className="right">
          <div className="pill" title="Cells remaining to reveal">
            <span className="pill-dot" />
            <span className="pill-text">Remaining</span>
            <span className="pill-num">{remaining.toLocaleString()}</span>
          </div>
          <button className="cta" onClick={gotoSupport}>
            Support
          </button>

          {/* mobile toggle */}
          <button
            className="hamburger"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {/* mobile drawer (filled background) */}
      <div
        className={`drawer ${open ? "open" : ""}`}
        onClick={() => setOpen(false)}
      >
        <div className="drawer-inner" onClick={(e) => e.stopPropagation()}>
          <Nav to="/" label="Canvas" onClick={() => setOpen(false)} />
          <Nav to="/support" label="Support" onClick={() => setOpen(false)} />
          <Nav to="/simulate" label="Simulate" onClick={() => setOpen(false)} />
          <div className="drawer-sep" />
          <div className="drawer-remaining">
            <span>Remaining:</span> <b>{remaining.toLocaleString()}</b>
          </div>
          <button className="cta wide" onClick={gotoSupport}>
            Support
          </button>
        </div>
      </div>
    </header>
  );
}

function Nav({ to, label, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) => `link ${isActive ? "active" : ""}`}
    >
      {label}
    </NavLink>
  );
}
