import { TYPE_META } from "../lib/worldData";
import AssetCard from "../components/AssetCard";
import { Btn } from "../components/ui";
import { IconArrowRight } from "../components/Icons";

const QUICK_START = [
  { id: "create", icon: "✨", title: "Add your first idea", text: "Turn a fragment into a full, grounded entry.", cta: "Grow an idea" },
  { id: "characters", icon: "🧑", title: "Talk to a character", text: "Generate an NPC and chat with them directly.", cta: "Meet someone" },
  { id: "timeline", icon: "🕰️", title: "Travel through time", text: "See any entry re-rendered in another era.", cta: "Shift an era" },
  { id: "canon", icon: "📖", title: "Browse your World Book", text: "Search, filter, and audit everything you've built.", cta: "Open World Book" },
];

const FLOW_STEPS = [
  { n: "1", title: "Add a fragment", text: "A name, a sketch, one sentence — typing optional, pick from a list." },
  { n: "2", title: "Grounded generation", text: "The most relevant canon is retrieved and sent to Granite as context." },
  { n: "3", title: "Tagged & saved", text: "The result is tagged by era, faction, type, and mood — searchable instantly." },
  { n: "4", title: "Explore it", text: "It shows up in your World Book, in a chat thread, or across eras." },
];

export default function Home({ world, assets, setTab }) {
  const byType = {};
  assets.forEach((a) => { byType[a.type] = (byType[a.type] || 0) + 1; });
  const recent = [...assets].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3);

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 32 }}>
        <div className="section-label">{world.personaLabel}</div>
        <h1 style={{ fontSize: 30, marginBottom: 8 }}>{world.name}</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 15, maxWidth: 620, lineHeight: 1.6 }}>
          {assets.length} {assets.length === 1 ? "entry" : "entries"} so far. Not sure where to start? Pick one of the four things below —
          each one takes under a minute.
        </p>
      </div>

      <div className="grid-cards" style={{ marginBottom: 40 }}>
        {QUICK_START.map((q) => (
          <div key={q.id} className="card card-hover" onClick={() => setTab(q.id)} title={q.text} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 26 }}>{q.icon}</div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17 }}>{q.title}</div>
            <p style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.55, flex: 1 }}>{q.text}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent-strong)", fontSize: 13.5, fontWeight: 600 }}>
              {q.cta} <IconArrowRight width={15} height={15} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }} className="home-lower">
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h2 style={{ fontSize: 18 }}>Recently added</h2>
            <Btn small variant="ghost" onClick={() => setTab("canon")} title="See every entry in your World Book">View all <IconArrowRight width={14} height={14} /></Btn>
          </div>
          {recent.length === 0 ? (
            <div className="card" style={{ color: "var(--text-dim)", fontSize: 14.5 }}>Nothing yet — add your first idea to see it here.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {recent.map((a) => <AssetCard key={a.id} asset={a} compact />)}
            </div>
          )}

          <h2 style={{ fontSize: 18, margin: "32px 0 14px" }}>How it works</h2>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {FLOW_STEPS.map((s) => (
              <div key={s.n} style={{ display: "flex", gap: 14 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent-strong)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0,
                }}>{s.n}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{s.title}</div>
                  <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>{s.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: 18, marginBottom: 14 }}>Your world at a glance</h2>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Object.keys(TYPE_META).map((t) => (
              <div key={t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span>{TYPE_META[t].icon}</span> {TYPE_META[t].label}
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
