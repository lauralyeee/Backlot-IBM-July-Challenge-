import { TYPE_META } from "../lib/worldData";
import AssetCard from "../components/AssetCard";
import { Btn, Banner, Tag } from "../components/ui";
import { IconArrowRight, TypeIcon } from "../components/Icons";

const FLOW_STEPS = [
  { n: "1", title: "Capture a fragment", text: "A name, a sketch, a line of dialogue: the starting point can be as small as you like." },
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

  // ── "Story shape" stats ──────────────────────────────────────────────────
  // A screenwriter/producer glancing at this page cares less about raw
  // totals and more about structural health: is the story balanced across
  // its acts, is the cast/affiliation spread coherent, and is the world
  // still being actively built. Each block below is derived from data that
  // already exists on assets/world.

  // Balance across eras (acts): total entries and, specifically, events
  // (plot beats) per era. An era with zero events is the clearest signal
  // of a structural gap a writer would want to know about immediately.
  const byEra = {};
  (world.eras || []).forEach((e) => { byEra[e] = { total: 0, events: 0 }; });
  assets.forEach((a) => {
    if (!byEra[a.era]) byEra[a.era] = { total: 0, events: 0 };
    byEra[a.era].total += 1;
    if (a.type === "event") byEra[a.era].events += 1;
  });
  const maxEraTotal = Math.max(1, ...(world.eras || []).map((e) => byEra[e]?.total || 0));

  // Cast by affiliation. Labeled "affiliation" in the UI (not "faction") to
  // match the term used everywhere else in the app (Export, WorldBook) --
  // "faction" is the internal field name, but it's genre-coded (reads as
  // fantasy/sci-fi) and would be an odd label on a rom-com or drama world.
  // A character's affiliation is free text -- a family, a police
  // department, a guild, a corporation, whatever this world calls it.
  const factionCounts = {};
  assets.filter((a) => a.type === "character").forEach((a) => {
    const f = a.faction && a.faction !== "—" ? a.faction : "Unaffiliated";
    factionCounts[f] = (factionCounts[f] || 0) + 1;
  });
  const factionEntries = Object.entries(factionCounts).sort((a, b) => b[1] - a[1]);
  const characterCount = byType.character || 0;

  // Tone palette: mood tags aggregated into a distribution, so the world's
  // emotional fingerprint is visible without reading every entry.
  const moodCounts = {};
  assets.forEach((a) => {
    const m = (a.mood || "").trim();
    if (m) moodCounts[m] = (moodCounts[m] || 0) + 1;
  });
  const moodEntries = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Momentum: entries added in the last 7 days.
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentWeekCount = assets.filter((a) => (a.createdAt || 0) >= oneWeekAgo).length;

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
          Your world is missing {missing.map((m) => m.label).join(", ")}. Filling these in helps every generation and character chat stay grounded in your world.
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

      {!isNewWorld && (
        <div style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 18, marginBottom: 14 }}>Story shape</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>

            <div className="card">
              <div className="section-label">Balance across eras</div>
              <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "4px 0 0", lineHeight: 1.5 }}>
                Entries logged in each era, and how many of those are events (plot beats).
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                {(world.eras || []).map((e) => {
                  const stat = byEra[e] || { total: 0, events: 0 };
                  const pct = Math.round((stat.total / maxEraTotal) * 100);
                  return (
                    <div
                      key={e}
                      title={`"${e}": ${stat.total} ${stat.total === 1 ? "entry" : "entries"} total, ${stat.events} of them ${stat.events === 1 ? "an event" : "events"}`}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4, gap: 8 }}>
                        <span style={{ color: "var(--text-dim)" }}>{e}</span>
                        <span style={{ flexShrink: 0 }}>
                          {stat.total} {stat.total === 1 ? "entry" : "entries"}
                          {stat.events === 0
                            ? <span style={{ color: "var(--text-faint)" }}> · no events yet</span>
                            : ` · ${stat.events} event${stat.events === 1 ? "" : "s"}`}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 4, background: "var(--border-soft)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 4 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="section-label">Cast by affiliation</div>
              {factionEntries.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 10 }}>
                  No characters yet, so there's nothing to group. Affiliation is whatever group you give a character — a family, a department, a guild, a corporation.
                </p>
              ) : (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
                    {factionEntries.map(([f, count]) => (
                      <div key={f} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                        <span style={{ color: "var(--text-dim)" }}>{f}</span>
                        <span style={{ fontWeight: 600, fontFamily: "var(--font-display)" }}>{count}</span>
                      </div>
                    ))}
                  </div>
                  <hr className="hairline" style={{ margin: "12px 0 10px" }} />
                  <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
                    {characterCount} character{characterCount === 1 ? "" : "s"} across {factionEntries.length} affiliation{factionEntries.length === 1 ? "" : "s"}
                  </div>
                </>
              )}
            </div>

            <div className="card">
              <div className="section-label">Tone &amp; momentum</div>
              {moodEntries.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                  {moodEntries.map(([m, count]) => <Tag key={m}>{m} · {count}</Tag>)}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 10 }}>No mood tags yet.</p>
              )}
              <hr className="hairline" style={{ margin: "12px 0 10px" }} />
              <div style={{ fontSize: 13 }}>
                {recentWeekCount} entr{recentWeekCount === 1 ? "y" : "ies"} added in the last 7 days
              </div>
            </div>

          </div>
        </div>
      )}

      <style>{`@media (max-width: 900px) { .home-lower { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
