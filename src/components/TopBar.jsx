import { IconSun, IconMoon } from "./Icons";

export default function TopBar({ title, subtitle, mode, toggleTheme, right }) {
  return (
    <div className="topbar">
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 19, fontWeight: 600 }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 1 }}>{subtitle}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {right}
        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
          {mode === "dark" ? <IconSun /> : <IconMoon />}
        </button>
      </div>
    </div>
  );
}
