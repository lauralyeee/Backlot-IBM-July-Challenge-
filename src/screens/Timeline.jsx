import { useState } from "react";
import { generateAsset } from "../lib/api";
import { Chip, Btn, Busy, Banner, EmptyState } from "../components/ui";
import AssetCard from "../components/AssetCard";

export default function Timeline({ world, assets, addAsset }) {
  const [subjectId, setSubjectId] = useState("");
  const [era, setEra] = useState(world.eras[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const subject = assets.find((a) => String(a.id) === subjectId);

  async function shift() {
    setBusy(true); setError(""); setResult(null);
    try {
      const res = await generateAsset(world.id, "era_shift", {
        subjectId: subject.id,
        era,
      });
      const asset = { ...res.asset, era };
      addAsset(asset); setResult(asset);
    } catch (e) {
      setError(`Couldn't shift that entry: ${e.message} Please try again.`);
    }
    setBusy(false);
  }

  if (assets.length === 0) {
    return <EmptyState icon="🕰️" title="Nothing to time-shift yet" text="Add an entry to your World Book first, then come back here to see it in another era." />;
  }

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, marginBottom: 6 }}>Time-Shift Mode</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14.5 }}>Pick an entry, choose an era, and see it re-rendered without breaking continuity.</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-label">1. Pick something from your world</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {assets.map((a) => <Chip key={a.id} active={subjectId === String(a.id)} onClick={() => setSubjectId(String(a.id))}>{a.title}</Chip>)}
        </div>

        <div className="section-label">2. Choose an era</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {world.eras.map((e) => (
            <button
              key={e}
              onClick={() => setEra(e)}
              title={(world.eraNotes || {})[e] || ""}
              style={{
                flex: 1, padding: "14px 10px", borderRadius: "var(--radius-sm)", cursor: "pointer", textAlign: "center",
                border: `2px solid ${era === e ? "var(--accent)" : "var(--border)"}`,
                background: era === e ? "var(--accent-soft)" : "var(--bg-elevated)",
                color: era === e ? "var(--accent-strong)" : "var(--text)",
                fontWeight: era === e ? 700 : 500, fontSize: 13.5,
              }}
            >
              {e}
            </button>
          ))}
        </div>

        {((world.eraNotes || {})[era] || "").trim() ? (
          <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "6px 0 0", lineHeight: 1.55 }}>
            {world.eraNotes[era]}
          </p>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--text-faint)", margin: "6px 0 0", lineHeight: 1.55 }}>
            "{era}" has no description yet — add one in Settings → Timeline / eras (or ✨ Auto-describe)
            so shifts and portraits know what this era actually means.
          </p>
        )}

        <Btn variant="primary" onClick={shift} disabled={busy || !subject} style={{ marginTop: 12 }}>
          {busy ? "Traveling…" : `Show it in ${era}`}
        </Btn>
      </div>

      {busy && <Busy label={`Traveling to ${era}…`} />}
      {error && <Banner tone="danger">{error}</Banner>}

      {result && subject && (
        <div>
          <div className="section-label">Before &amp; after</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} id="timeline-compare">
            <div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Original · {subject.era}</div>
              <AssetCard asset={subject} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--accent-strong)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Shifted · {era}</div>
              <AssetCard asset={result} />
            </div>
          </div>
        </div>
      )}

      <style>{`@media (max-width: 760px) { #timeline-compare { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
