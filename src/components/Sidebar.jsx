import { useState } from "react";
import { IconHome, IconBook, IconSpark, IconChat, IconClock, IconSettings, IconChevronDown, IconImport, IconExport, IconCube, IconSun, IconMoon, IconMore, IconClose } from "./Icons";

const TOP_NAV = [
  { id: "home", label: "Home", icon: IconHome, title: "A snapshot of your world" },
  { id: "canon", label: "World Book", icon: IconBook, title: "Search, filter, edit, ask questions, and run a consistency check on every canon entry" },
  { id: "gallery", label: "Gallery", icon: IconCube, title: "3D concept models, concept art, and video for any character, location, or entry" },
];

const IDEA_GEN_ITEMS = [
  { id: "create", label: "Add to World", icon: IconSpark, title: "Turn a fragment into a new, grounded entry" },
  { id: "characters", label: "Characters", icon: IconChat, title: "Generate characters and chat with them" },
  { id: "timeline", label: "Timeline", icon: IconClock, title: "See any entry re-rendered in a different era, and set up your eras" },
];

const BOTTOM_NAV = [
  { id: "import", label: "Import", icon: IconImport, title: "Extract entries from a script or document" },
  { id: "export", label: "Export", icon: IconExport, title: "Compile your world into a shareable document" },
  { id: "settings", label: "Settings", icon: IconSettings, title: "Manage your world, roles, and appearance" },
];

export default function Sidebar({ tab, setTab, world, assetCount, mode, toggleTheme }) {
  const [ideaOpen, setIdeaOpen] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);

  const ideaGroupActive = IDEA_GEN_ITEMS.some((n) => n.id === tab);
  const moreItems = [...IDEA_GEN_ITEMS, ...BOTTOM_NAV];
  const moreGroupActive = moreItems.some((n) => n.id === tab);

  function selectTab(id) {
    setTab(id);
    setMoreOpen(false);
  }

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-name">{world.name}</div>
            <div className="brand-sub">{world.personaLabel}</div>
          </div>
        </div>

        <ul className="nav-list">
          {/* Top-level items: Home, World Book, Gallery — always visible, desktop and mobile */}
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

          {/* Collapsible Idea Generation group — desktop only; folded into the mobile "More" sheet */}
          <li className="nav-group">
            <button
              className={`nav-item nav-group-header ${ideaGroupActive && !ideaOpen ? "active" : ""}`}
              onClick={() => setIdeaOpen((o) => !o)}
              aria-expanded={ideaOpen}
              title="Expand for Add to World, Characters, and Timeline"
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

          {/* Bottom-level items: Import, Export, Settings — desktop only; folded into the mobile "More" sheet */}
          {BOTTOM_NAV.map((n) => {
            const Icon = n.icon;
            return (
              <li key={n.id} className="nav-bottom-item">
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

          {/* Mobile-only trigger for the remaining items, shown via CSS in place of the group above */}
          <li className="nav-more-trigger">
            <button
              className={`nav-item ${moreGroupActive ? "active" : ""}`}
              onClick={() => setMoreOpen(true)}
              title="More: Add to World, Characters, Timeline, Import, Export, Settings"
            >
              <IconMore className="nav-icon" />
              More
            </button>
          </li>
        </ul>

        <div className="sidebar-footer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 }}>
            Backlot
          </div>
          {toggleTheme && (
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title="Switch between light and dark mode"
              style={{ width: 32, height: 32, flexShrink: 0 }}
            >
              {mode === "dark" ? <IconSun width={15} height={15} /> : <IconMoon width={15} height={15} />}
            </button>
          )}
        </div>
      </aside>

      {moreOpen && (
        <div className="mobile-more-overlay" onClick={() => setMoreOpen(false)}>
          <div className="mobile-more-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-more-sheet-header">
              <span>More</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
              >
                <IconClose width={16} height={16} />
              </button>
            </div>

            <div className="mobile-more-section-label">Idea Generation</div>
            <ul className="mobile-more-list">
              {IDEA_GEN_ITEMS.map((n) => {
                const Icon = n.icon;
                return (
                  <li key={n.id}>
                    <button
                      className={`nav-item ${tab === n.id ? "active" : ""}`}
                      onClick={() => selectTab(n.id)}
                    >
                      <Icon className="nav-icon" />
                      {n.label}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mobile-more-section-label">Workspace</div>
            <ul className="mobile-more-list">
              {BOTTOM_NAV.map((n) => {
                const Icon = n.icon;
                return (
                  <li key={n.id}>
                    <button
                      className={`nav-item ${tab === n.id ? "active" : ""}`}
                      onClick={() => selectTab(n.id)}
                    >
                      <Icon className="nav-icon" />
                      {n.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
