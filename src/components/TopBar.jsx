import { IconSun, IconMoon } from "./Icons";

// A slim utility strip only — no page title/subtitle here. Every screen
// already renders its own heading and description at the top of its
// content, so a second title in this bar was pure duplication.
export default function TopBar({ mode, toggleTheme, right }) {
  return (
    <div className="topbar" style={{ justifyContent: "flex-end" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {right}
        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Switch between light and dark mode">
          {mode === "dark" ? <IconSun /> : <IconMoon />}
        </button>
      </div>
    </div>
  );
}
