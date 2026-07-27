import { useState } from "react";
import { IconHome, IconBook, IconSpark, IconChat, IconClock, IconSettings, IconChevronDown, IconImport, IconExport } from "./Icons";

const TOP_NAV = [
  { id: "home", label: "Home", icon: IconHome, title: "Home — a snapshot of your world and quick starts" },
  { id: "canon", label: "World Book", icon: IconBook, title: "World Book — search, filter, and edit every canon entry" },
];

const IDEA_GEN_ITEMS = [
  { id: "create", label: "Add to World", icon: IconSpark, title: "Add to World — turn a fragment into a new, grounded entry" },
  { id: "characters", label: "Characters", icon: IconChat, title: "Characters — generate NPCs and chat with them" },
  { id: "timeline", label: "Timeline", icon: IconClock, title: "Timeline — see any entry re-rendered in a different era" },
];

const BOTTOM_NAV = [
  { id: "import", label: "Import", icon: IconImport, title: "Import — extract entries from a script or document" },
  { id: "export", label: "Export", icon: IconExport, title: "Export — compile your world into a shareable document" },
  { id: "settings", label: "Settings", icon: IconSettings, title: "Settings — manage your world, roles, eras, and appearance" },
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
                title={n.title}
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
            title="Idea Generation — expand for Add to World, Characters, and Timeline"
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
                      title={n.title}
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
                title={n.title}
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
