import { TYPE_META } from "../lib/worldData";
import AssetCard from "../components/AssetCard";
import { Btn, Banner } from "../components/ui";
import { IconArrowRight, TypeIcon } from "../components/Icons";

const FLOW_STEPS = [
  { n: "1", title: "Capture a fragment", text: "A name, a sketch, a line of dialogue — the starting point can be as small as you like." },
  { n: "2", title: "Ground it in canon", text: "The relevant parts of your World Book are retrieved and used as context for generation." },
  { n: "3", title: "File and tag", text: "The result is tagged by era, affiliation, type, and mood, and becomes part of your canon." },
  { n: "4", title: "Reference it anywhere", text: "It's now searchable in your World Book, speakable in a character chat, and available across eras." },
];

export default function Home({ world, assets, setTab }) {
  const byType = {};
  assets.forEach((a) => { byType[a.type] = (byType[a.type] || 0) + 1; });
  const recent = [...assets].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3);
  const isNewWorld = assets.length === 0;

  // Light-touch, non-blocking setup checklist -- never gates anything, just
  // nudges toward the handful of things that make every generation call
  // (and character chat) actually understand this world. Factions/events are
  // deliberately excluded: they're not universal across genres, so flagging
  // their absence would be noise rather than signal.
  const missing = [];
  if (!(world.description || "").trim()) missing.push({ label: "a world premise", tab: "settings" });
  if (!byType.location) missing.push({ label: "a location", tab: "create" });
  if (!byType.character) missing.push({ label: "a character", tab: "characters" });
  const eraNotes = world.eraNotes || {};
  const bareEras = (world.eras || []).filter((e) => !(eraNotes[e] || "").trim());
  if (bareEras.length) missing.push({ label: `${bareEras.length} era description${bareEras.length > 1 ? "s" : ""}`, tab: "settings" });

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 32 }}>
        <div className="section-label">{world.personaLabel}</div>
        <h1 style={{ fontSize: 30, marginBottom: 8 }}>{world.name}</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 15, maxWidth: 620, lineHeight: 1.6 }}>
          {assets.length} {assets.length === 1 ? "entry" : "entries"} in your World Book.
        </p>
      </div>

      {missing.length > 0 && (
        <Banner
          tone="accent"
          action={<Btn small onClick={() => setTab(missing[0].tab)} title={`Go add ${missing[0].label}`}>Set up now</Btn>}
        >
          Your world is missing {missing.map((m) => m.label).join(", ")} — filling these in helps every generation and character chat stay grounded in your world.
        </Banner>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }} className="home-lower">
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 18 }}>Recently added</h2>
            <Btn small variant="ghost" onClick={() => setTab("canon")} title="See every entry in your World Book">View all <IconArrowRight width={14} height={14} /></Btn>
          </div>
          {recent.length === 0 ? (
            <div className="card" style={{ color: "var(--text-dim)", fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span>Nothing in your World Book yet.</span>
              <Btn small variant="primary" onClick={() => setTab("create")} title="Add your first entry to this world">Add your first entry</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {recent.map((a) => <AssetCard key={a.id} asset={a} compact />)}
            </div>
          )}

          {/* "How it works" is onboarding content, not a permanent dashboard
              fixture -- it stays useful for a brand-new, empty world and
              becomes redundant clutter once a writer already has entries to
              work from, so it's shown only until the first entry lands. */}
          {isNewWorld && (
            <>
              <h2 style={{ fontSize: 18, margin: "32px 0 14px" }}>How it works</h2>
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {FLOW_STEPS.map((s) => (
                  <div key={s.n} style={{ display: "flex", gap: 14 }}>
                    <div className="slate-number" style={{
                      width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border)",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0,
                    }}>{s.n}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{s.title}</div>
                      <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>{s.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <h2 style={{ fontSize: 18, marginBottom: 14 }}>Your world at a glance</h2>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Object.keys(TYPE_META).map((t) => (
              <div key={t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--text-dim)" }}>
                  <TypeIcon type={t} width={15} height={15} /> {TYPE_META[t].label}
                </div>
                <span style={{ fontWeight: 700, fontFamily: "var(--font-display)" }}>{byType[t] || 0}</span>
              </div>
            ))}
            <hr className="hairline" style={{ margin: "4px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600 }}>
              <span>Total</span><span>{assets.length}</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 900px) { .home-lower { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
