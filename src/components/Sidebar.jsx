import { IconHome, IconBook, IconSpark, IconChat, IconClock, IconSettings } from "./Icons";

const NAV = [
  { id: "home", label: "Home", icon: IconHome },
  { id: "canon", label: "World Book", icon: IconBook },
  { id: "create", label: "Add to World", icon: IconSpark },
  { id: "characters", label: "Characters", icon: IconChat },
  { id: "timeline", label: "Timeline", icon: IconClock },
  { id: "settings", label: "Settings", icon: IconSettings },
];

export default function Sidebar({ tab, setTab, world, assetCount }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">{world.name.charAt(0).toUpperCase()}</div>
        <div>
          <div className="brand-name">{world.name}</div>
          <div className="brand-sub">{world.personaLabel}</div>
        </div>
      </div>

      <ul className="nav-list">
        {NAV.map((n) => {
          const Icon = n.icon;
          return (
            <li key={n.id}>
              <button className={`nav-item ${tab === n.id ? "active" : ""}`} onClick={() => setTab(n.id)}>
                <Icon className="nav-icon" />
                {n.label}
                {n.id === "canon" && <span className="nav-badge">{assetCount}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="sidebar-footer">
        <div style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 }}>
          Worldbuilding Co-Pilot · POC
        </div>
      </div>
    </aside>
  );
}
