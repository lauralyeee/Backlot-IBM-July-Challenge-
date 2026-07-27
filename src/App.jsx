import { useState, useEffect, useCallback } from "react";
import { ROLES } from "./lib/worldData";
import { createWorld, getWorld, patchWorld, listAssets, saveAsset, deleteAsset } from "./lib/api";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Onboarding from "./screens/Onboarding";
import Home from "./screens/Home";
import WorldBook from "./screens/WorldBook";
import Create from "./screens/Create";
import Characters from "./screens/Characters";
import Timeline from "./screens/Timeline";
import Settings from "./screens/Settings";
import Import from "./screens/Import";
import Export from "./screens/Export";

const TITLES = {
  home: ["Home", "Where to start"],
  canon: ["World Book", "Everything true about your world"],
  create: ["Add to World", "Gap-Filling Engine"],
  characters: ["Characters", "NPC Cast Generator & chat"],
  timeline: ["Timeline", "Time-Shift Mode"],
  settings: ["Settings", "Your world, your rules"],
  import: ["Import", "Bring in world data"],
  export: ["Export", "Take your world data out"],
};

// Persist world-id + ui mode in localStorage (non-sensitive, no credentials)
const UI_KEY = "worldbuilding-copilot:ui:v2";
function loadUi() {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; }
}
function saveUi(data) {
  try { localStorage.setItem(UI_KEY, JSON.stringify(data)); } catch { /* noop */ }
}

export default function App() {
  const ui = loadUi();
  const [mode, setMode] = useState(ui.mode || "dark");
  const [worldId, setWorldId] = useState(ui.worldId || null);
  const [world, setWorld] = useState(null);
  const [assets, setAssets] = useState([]);
  const [tab, setTab] = useState("home");
  const [loading, setLoading] = useState(!!ui.worldId);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
  }, [mode]);

  // Bootstrap: load world + assets from backend on mount
  useEffect(() => {
    if (!worldId) { setLoading(false); return; }
    setLoading(true);
    Promise.all([getWorld(worldId), listAssets(worldId)])
      .then(([w, a]) => {
        setWorld({ ...w, rolesFull: ROLES.filter((r) => w.roles.includes(r.id)) });
        setAssets(a);
      })
      .catch(() => {
        // World not found in DB — clear the stale reference and show onboarding
        setWorldId(null);
        saveUi({ mode });
      })
      .finally(() => setLoading(false));
  }, [worldId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTheme = () => {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    saveUi({ worldId, mode: next });
  };

  // Called by Create / Characters / Timeline when a new asset comes back from the API.
  // Era-shift re-generations update an existing DB row in place (same id) rather
  // than creating a new one, so this must replace-by-id instead of blindly
  // appending — otherwise the same entry shows up twice in the UI until reload.
  const addAsset = useCallback((a) => {
    setAssets((prev) => {
      const idx = prev.findIndex((p) => p.id === a.id);
      if (idx === -1) return [...prev, a];
      const next = [...prev];
      next[idx] = a;
      return next;
    });
  }, []);

  // Called by WorldBook when a user deletes an asset
  const removeAsset = useCallback((assetId) => {
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
  }, []);

  // Called by Settings when world metadata changes
  const handleSetWorld = useCallback(async (updated) => {
    const { rolesFull: _, ...rest } = updated;
    try {
      const saved = await patchWorld(updated.id, rest);
      setWorld({ ...saved, rolesFull: ROLES.filter((r) => saved.roles.includes(r.id)) });
    } catch {
      // Optimistic local update if API call fails
      setWorld({ ...updated, rolesFull: ROLES.filter((r) => updated.roles.includes(r.id)) });
    }
  }, []);

  // Called by Settings after an era rename/remove, which already persisted
  // via its own dedicated endpoint (not patchWorld) — this just syncs the
  // authoritative world object the endpoint returned into local state,
  // without issuing a second, redundant PATCH.
  const applyWorldUpdate = useCallback((updated) => {
    setWorld({ ...updated, rolesFull: ROLES.filter((r) => updated.roles.includes(r.id)) });
  }, []);

  // Called by Settings after an era rename/remove that reassigned assets —
  // those assets' era field changed server-side, so the locally-held assets
  // list needs a refetch to stay in sync.
  const refreshAssets = useCallback(async () => {
    if (!worldId) return;
    const a = await listAssets(worldId);
    setAssets(a);
  }, [worldId]);

  const handleReset = useCallback(() => {
    setWorldId(null);
    setWorld(null);
    setAssets([]);
    saveUi({ mode });
  }, [mode]);

  if (loading) {
    return (
      <div style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--text-dim)", fontSize: 15 }}>Loading your world…</span>
      </div>
    );
  }

  if (!world) {
    return (
      <div style={{ background: "var(--bg)", color: "var(--text)" }}>
        <Onboarding
          mode={mode}
          toggleTheme={toggleTheme}
          onDone={async (w) => {
            // Generate a stable world id from name + timestamp
            const id = `${w.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}-${Date.now()}`;
            const worldData = {
              id,
              name: w.name,
              personaId: w.personaId,
              personaLabel: w.personaLabel,
              eras: w.eras,
              ideas: w.ideas,
              dialects: w.dialects || {},
              roles: w.roles,
              createdAt: Date.now(),
              seed: w.seed.map((s, i) => ({
                ...s,
                id: Date.now() + i + 1,
                createdAt: Date.now() - (w.seed.length - i) * 1000,
              })),
            };
            const created = await createWorld(worldData);
            const seedAssets = await listAssets(id);
            setWorld({ ...created, rolesFull: ROLES.filter((r) => created.roles.includes(r.id)) });
            setAssets(seedAssets);
            setWorldId(id);
            saveUi({ worldId: id, mode });
            setTab("home");
          }}
        />
      </div>
    );
  }

  const worldFull = { ...world, rolesFull: ROLES.filter((r) => world.roles.includes(r.id)) };
  const [title, subtitle] = TITLES[tab];

  return (
    <div className="app-shell">
      <Sidebar tab={tab} setTab={setTab} world={world} assetCount={assets.length} />
      <div className="main-col">
        <TopBar title={title} subtitle={subtitle} mode={mode} toggleTheme={toggleTheme} />
        <div className="content">
          {tab === "home" && <Home world={worldFull} assets={assets} setTab={setTab} />}
          {tab === "canon" && <WorldBook world={worldFull} assets={assets} setTab={setTab} removeAsset={removeAsset} addAsset={addAsset} />}
          {tab === "create" && <Create world={worldFull} assets={assets} addAsset={addAsset} />}
          {tab === "characters" && <Characters world={worldFull} assets={assets} addAsset={addAsset} />}
          {tab === "timeline" && <Timeline world={worldFull} assets={assets} addAsset={addAsset} />}
          {tab === "import" && <Import world={worldFull} addAsset={addAsset} />}
          {tab === "export" && <Export world={worldFull} assets={assets} />}
          {tab === "settings" && (
            <Settings
              world={world}
              setWorld={handleSetWorld}
              onWorldUpdated={applyWorldUpdate}
              refreshAssets={refreshAssets}
              mode={mode}
              toggleTheme={toggleTheme}
              onReset={handleReset}
            />
          )}
        </div>
      </div>
    </div>
  );
}
