import { useState } from "react";
import { ingestText, confirmAsset, deleteAsset } from "../lib/api";
import { Field, Btn, Busy, Banner, SectionLabel } from "../components/ui";
import AssetCard from "../components/AssetCard";

export default function Import({ world, addAsset, removeAsset }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [confirmingIds, setConfirmingIds] = useState([]);

  async function extract() {
    if (!text.trim()) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const res = await ingestText(world.id, { text, title });
      res.created.forEach((a) => addAsset(a));
      res.matches.forEach((m) => addAsset(m.existing));
      setResult(res);
      if (res.offline) {
        setError(`Service unavailable — extracted a rough offline draft instead. Review carefully before approving anything.`);
      }
    } catch (e) {
      setError(`Import failed: ${e.message}`);
    }
    setBusy(false);
  }

  async function approve(asset) {
    setConfirmingIds((prev) => [...prev, asset.id]);
    try {
      const saved = await confirmAsset(world.id, asset.id);
      addAsset(saved);
      setResult((prev) => prev && ({
        ...prev,
        created: prev.created.map((a) => (a.id === saved.id ? saved : a)),
      }));
    } catch (e) {
      setError(`Couldn't approve "${asset.title}": ${e.message}`);
    }
    setConfirmingIds((prev) => prev.filter((id) => id !== asset.id));
  }

  async function reject(asset) {
    setConfirmingIds((prev) => [...prev, asset.id]);
    try {
      await deleteAsset(world.id, asset.id);
      removeAsset(asset.id);
      setResult((prev) => prev && ({
        ...prev,
        created: prev.created.filter((a) => a.id !== asset.id),
      }));
    } catch (e) {
      setError(`Couldn't reject "${asset.title}": ${e.message}`);
    }
    setConfirmingIds((prev) => prev.filter((id) => id !== asset.id));
  }

  return (
    <div className="fade-in" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, marginBottom: 6 }}>Import</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14.5 }}>
          Paste a script, treatment, outline, or pitch doc. It's broken down into
          characters, locations, and props, checked against what's already in your
          World Book, and added as unconfirmed drafts for you to review.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-label">Document title</div>
        <Field value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Episode 3 draft" style={{ marginBottom: 14 }} />
        <div className="section-label">Paste text</div>
        <Field area rows={10} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Paste script, treatment, outline, or pitch doc text here…" />
        <div style={{ marginTop: 14 }}>
          <Btn variant="primary" onClick={extract} disabled={busy || !text.trim()}>Extract</Btn>
        </div>
      </div>

      {busy && <Busy label="Reading the document and extracting elements…" />}
      {error && <Banner tone="danger">{error}</Banner>}

      {result && (
        <>
          {result.created.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionLabel>New — needs review ({result.created.length})</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {result.created.map((a) => (
                  <AssetCard
                    key={a.id}
                    asset={a}
                    actions={
                      <>
                        <Btn small variant="primary" disabled={confirmingIds.includes(a.id)} onClick={() => approve(a)}>Approve</Btn>
                        <Btn small disabled={confirmingIds.includes(a.id)} onClick={() => reject(a)}>Reject</Btn>
                      </>
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {result.matches.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionLabel>Already in your World Book ({result.matches.length})</SectionLabel>
              <p style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 12 }}>
                These names matched existing entries — nothing was overwritten. Compare and edit manually in the World Book if the document adds something new.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {result.matches.map((m, i) => (
                  <div key={i} className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 4 }}>Existing — {m.existing.title}</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{m.existing.content}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 4 }}>From this document</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{m.extracted.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.timelineMarkers.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionLabel>Timeline markers found</SectionLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {result.timelineMarkers.map((t, i) => (
                  <span key={i} className="tag">"{t.phrase}" → {t.resolvedEra || "unresolved era"}</span>
                ))}
              </div>
            </div>
          )}

          {result.relationships.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionLabel>Relationships found</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {result.relationships.map((r, i) => (
                  <div key={i} style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
                    <strong>{r.a}</strong> ↔ <strong>{r.b}</strong>{r.context ? ` — ${r.context}` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.created.length === 0 && result.matches.length === 0 && (
            <Banner tone="accent">Nothing extractable was found in that text.</Banner>
          )}
        </>
      )}
    </div>
  );
}
