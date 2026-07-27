import { useState } from "react";
import { generateAsset } from "../lib/api";
import { offlineAsset } from "../lib/generation";
import { Chip, Field, Btn, Busy, Banner } from "../components/ui";
import { IconSpark } from "../components/Icons";
import AssetCard from "../components/AssetCard";

export default function Create({ world, assets, addAsset }) {
  const [fragment, setFragment] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [grounding, setGrounding] = useState([]);

  const pickIdea = (idea) => { setPicked(idea.label); setFragment(idea.text); };

  async function run(mode) {
    setBusy(true); setError(""); setResult(null); setGrounding([]);
    try {
      const res = await generateAsset(world.id, mode, { fragment });
      addAsset(res.asset);
      setResult(res.asset);
      setGrounding(res.grounding || []);
      setFragment(""); setPicked(null);
      if (res.offline) setError(`Service unavailable (${res.error}). Saved a local draft instead — reopen it when the service returns.`);
    } catch (e) {
      // Network error (backend unreachable) — produce a local draft without hitting API
      const draft = offlineAsset(
        mode === "character" ? "a new figure connected to this world" : fragment,
        world, assets, mode === "character" ? "character" : null,
      );
      addAsset(draft); setResult(draft); setFragment(""); setPicked(null);
      setError(`Service unavailable (${e.message}). Saved a local draft instead — reopen it when the service returns.`);
    }
    setBusy(false);
  }

  return (
    <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 32 }} id="create-grid">
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 26, marginBottom: 6 }}>Add to your World</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14.5 }}>Pick a starter idea, or write your own — either way it grows into a full entry grounded in your existing canon.</p>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="section-label">Starter ideas</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(world.ideas || []).map((idea) => (
              <Chip key={idea.label} active={picked === idea.label} onClick={() => pickIdea(idea)} title={idea.text}>{idea.label}</Chip>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-label">Or write your own</div>
          <Field area rows={4} value={fragment} onChange={(e) => { setFragment(e.target.value); setPicked(null); }}
            placeholder="Any small idea works — a name, a place, one sentence." />
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <Btn variant="primary" onClick={() => run("expand")} disabled={busy || !fragment.trim()} title="Expand your written fragment into a full entry, grounded in your world's canon">
              <IconSpark width={16} height={16} /> Grow my idea
            </Btn>
            <Btn onClick={() => run("character")} disabled={busy} title="Generate a brand-new character connected to your world">Surprise me with a character</Btn>
          </div>
        </div>

        {busy && <Busy label="Retrieving related canon and weaving it in…" />}
        {error && <Banner tone="danger">{error}</Banner>}

        {result && (
          <div style={{ marginTop: 24 }}>
            <div className="section-label">Saved to your World Book</div>
            <AssetCard asset={result} />
          </div>
        )}
      </div>

      <div>
        <div className="section-label">Grounding context</div>
        <p style={{ fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6, marginBottom: 14 }}>
          Before generating, the app retrieves the canon entries most relevant to your fragment and sends them to Granite as context — this is what keeps new content consistent instead of generic.
        </p>
        {grounding.length === 0 ? (
          <div className="card" style={{ fontSize: 13.5, color: "var(--text-faint)" }}>
            Nothing retrieved yet — generate something to see which existing entries it was grounded in.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {grounding.slice(0, 6).map((a) => (
              <div key={a.id} className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{a.type} · {a.era}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`@media (max-width: 900px) { #create-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
