import { useState } from "react";
import { IconHome, IconBook, IconSpark, IconChat, IconClock, IconSettings, IconChevronDown, IconImport, IconExport } from "./Icons";

const TOP_NAV = [
  { id: "home", label: "Home", icon: IconHome },
  { id: "canon", label: "World Book", icon: IconBook },
];

const IDEA_GEN_ITEMS = [
  { id: "create", label: "Add to World", icon: IconSpark },
  { id: "characters", label: "Characters", icon: IconChat },
  { id: "timeline", label: "Timeline", icon: IconClock },
];

const BOTTOM_NAV = [
  { id: "import", label: "Import", icon: IconImport },
  { id: "export", label: "Export", icon: IconExport },
  { id: "settings", label: "Settings", icon: IconSettings },
];

export default function Sidebar({ tab, setTab, world, assetCount }) {
  const [ideaOpen, setIdeaOpen] = useState(true);

  const ideaGroupActive = IDEA_GEN_ITEMS.some((n) => n.id === tab);

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
        {/* Top-level items: Home, World Book */}
        {TOP_NAV.map((n) => {
          const Icon = n.icon;
          return (
            <li key={n.id}>
              <button
                className={`nav-item ${tab === n.id ? "active" : ""}`}
                onClick={() => setTab(n.id)}
              >
                <Icon className="nav-icon" />
                {n.label}
                {n.id === "canon" && <span className="nav-badge">{assetCount}</span>}
              </button>
            </li>
          );
        })}

        {/* Collapsible Idea Generation group */}
        <li className="nav-group">
          <button
            className={`nav-item nav-group-header ${ideaGroupActive && !ideaOpen ? "active" : ""}`}
            onClick={() => setIdeaOpen((o) => !o)}
            aria-expanded={ideaOpen}
          >
            <IconSpark className="nav-icon" />
            Idea Generation
            <IconChevronDown
              className={`nav-chevron ${ideaOpen ? "nav-chevron-open" : ""}`}
            />
          </button>
          {ideaOpen && (
            <ul className="nav-sublist" role="list">
              {IDEA_GEN_ITEMS.map((n) => {
                const Icon = n.icon;
                return (
                  <li key={n.id}>
                    <button
                      className={`nav-item nav-subitem ${tab === n.id ? "active" : ""}`}
                      onClick={() => setTab(n.id)}
                    >
                      <Icon className="nav-icon" />
                      {n.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </li>

        {/* Bottom-level items: Import, Export, Settings */}
        {BOTTOM_NAV.map((n) => {
          const Icon = n.icon;
          return (
            <li key={n.id}>
              <button
                className={`nav-item ${tab === n.id ? "active" : ""}`}
                onClick={() => setTab(n.id)}
              >
                <Icon className="nav-icon" />
                {n.label}
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
