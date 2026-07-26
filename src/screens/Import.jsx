import { useState, useMemo } from "react";
import { ingestText, commitIngested } from "../lib/api";
import { TYPE_META } from "../lib/worldData";
import { Field, Btn, Chip, Busy, Banner, Tag, EmptyState } from "../components/ui";
import { IconSpark } from "../components/Icons";

const SAMPLE_SCRIPT = `EXT. THE OUTER HARBOUR — BEFORE DAWN

Fog sits low over the water. A single lamp burns at the end of the stone jetty.

MARETH SOLL (50s), harbourmaster, walks the length of the jetty with a ledger
under one arm. She has kept this ledger for thirty years and has never once
shown it to the council.

MARETH
    (to herself)
    Three ships out. Two ships back. Same as the last four winters.

A younger figure waits at the jetty's end — DERIN VASK, ship's navigator,
still wearing the salt-stained coat he arrived in.

DERIN
    You said you'd tell me what happened to the Kestrel.

MARETH
    I said I'd tell you when you were ready to hear it. Ten years later,
    you're still asking the same question the same way.

She sets the ledger on the stone between them. Inside its cover, stitched flat,
is a brass tide-key — the only one that still opens the old lockhouse.

DERIN
    And this?

MARETH
    That's how you'll find out. But once you turn it, the harbour will know
    you did.`;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "character", label: "Characters" },
  { id: "location", label: "Locations" },
  { id: "lore", label: "Props & lore" },
];

// Left accent bar per type, using the app's existing theme variables rather
// than a separate palette, so Import matches the rest of the screens.
const ACCENT = {
  character: "var(--accent)",
  location: "var(--teal)",
  lore: "var(--ok)",
};

function StatCard({ label, value, color }) {
  return (
    <div className="card" style={{ padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: color || "var(--text)" }}>{value}</div>
    </div>
  );
}

function ProposalCard({ item, onApprove, onReject, busy }) {
  const meta = TYPE_META[item.type] || { icon: "📄", label: item.type };
  return (
    <div
      className="card fade-in"
      style={{
        borderLeft: `3px solid ${ACCENT[item.type] || "var(--accent)"}`,
        display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 17 }}>{meta.icon}</span>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16 }}>{item.title}</div>
        </div>
        <span className="badge-proposed">proposed</span>
      </div>

      <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-dim)", margin: 0 }}>{item.content}</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Tag>{meta.label}</Tag>
        <Tag>{item.era}</Tag>
        {item.faction !== "—" && <Tag>{item.faction}</Tag>}
        <Tag>{item.mood}</Tag>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn small variant="primary" disabled={busy} onClick={() => onApprove(item)}>Add to World Book</Btn>
        <Btn small disabled={busy} onClick={() => onReject(item)}>Discard</Btn>
      </div>
    </div>
  );
}

export default function Import({ world, addAsset }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [staged, setStaged] = useState(null);      // full ingest response
  const [proposed, setProposed] = useState([]);    // not-yet-approved entries
  const [addedCount, setAddedCount] = useState(0);
  const [filter, setFilter] = useState("all");
  const [pendingIds, setPendingIds] = useState([]);

  const counts = useMemo(() => ({
    total: proposed.length,
    character: proposed.filter((p) => p.type === "character").length,
    location: proposed.filter((p) => p.type === "location").length,
  }), [proposed]);

  const visible = filter === "all" ? proposed : proposed.filter((p) => p.type === filter);

  async function extract() {
    if (!text.trim()) return;
    setBusy(true); setError(""); setNotice(""); setStaged(null); setProposed([]); setAddedCount(0);
    try {
      const res = await ingestText(world.id, { text, title });
      setStaged(res);
      setProposed(res.proposed);
      if (res.offline) {
        setError("Service unavailable — this is a rough offline extraction. Check each entry carefully before adding it.");
      }
    } catch (e) {
      setError(`Extraction failed: ${e.message}`);
    }
    setBusy(false);
  }

  async function approve(items) {
    const ids = items.map((i) => i.id);
    setPendingIds((prev) => [...prev, ...ids]);
    setError("");
    try {
      const res = await commitIngested(world.id, staged.document, items);
      res.created.forEach((a) => addAsset(a));
      setProposed((prev) => prev.filter((p) => !ids.includes(p.id)));
      setAddedCount((n) => n + res.created.length);
      setNotice(
        res.created.length === 1
          ? `"${res.created[0].title}" added to your World Book.`
          : `${res.created.length} entries added to your World Book.`
      );
    } catch (e) {
      setError(`Couldn't add: ${e.message}`);
    }
    setPendingIds((prev) => prev.filter((id) => !ids.includes(id)));
  }

  function reject(item) {
    setProposed((prev) => prev.filter((p) => p.id !== item.id));
  }

  return (
    <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "minmax(0, 420px) minmax(0, 1fr)", gap: 28 }} id="import-grid">
      {/* ── Left: source document ─────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <h1 style={{ fontSize: 25, marginBottom: 6 }}>Import</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14.5, lineHeight: 1.6 }}>
            Start from something you’ve already written. Paste a script, treatment,
            or outline and it’s broken down into entries you can review one by one.
          </p>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="section-label" style={{ marginBottom: 0 }}>Source document</div>
            <Btn small variant="ghost" onClick={() => { setText(SAMPLE_SCRIPT); setTitle("Sample scene"); }}>
              Load sample
            </Btn>
          </div>

          <Field
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Document name — e.g. Episode 3 draft"
            style={{ margin: "12px 0" }}
          />
          <Field
            area
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your script, treatment, outline, or pitch doc here…"
            style={{ fontSize: 13.5, lineHeight: 1.6 }}
          />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14 }}>
            <Btn variant="primary" onClick={extract} disabled={busy || !text.trim()}>
              <IconSpark width={16} height={16} /> Extract entries
            </Btn>
            {text.trim() && (
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
                {text.trim().split(/\s+/).length.toLocaleString()} words
              </span>
            )}
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.6, margin: 0 }}>
          Nothing is saved to your World Book until you approve it. Extracting is
          always safe to re-run — it never edits what’s already there.
        </p>
      </div>

      {/* ── Right: review queue ───────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <StatCard label="Awaiting review" value={counts.total} />
          <StatCard label="Characters" value={counts.character} color="var(--accent-strong)" />
          <StatCard label="Locations" value={counts.location} color="var(--teal)" />
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 380 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderBottom: "1px solid var(--border-soft)", paddingBottom: 14 }}>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600 }}>Review queue</div>
              <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 2 }}>
                {staged ? `From "${staged.document.title}"` : "Extracted entries appear here before they become canon."}
              </div>
            </div>
            {proposed.length > 0 && (
              <Btn small variant="primary" disabled={pendingIds.length > 0} onClick={() => approve(visible)}>
                Add all {filter === "all" ? "" : "shown "}({visible.length})
              </Btn>
            )}
          </div>

          {proposed.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {FILTERS.map((f) => (
                <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                  {f.id !== "all" && ` (${proposed.filter((p) => p.type === f.id).length})`}
                </Chip>
              ))}
            </div>
          )}

          {busy && <Busy label="Reading the document and pulling out entries…" />}
          {error && <Banner tone="danger">{error}</Banner>}
          {notice && !error && <Banner tone="ok">{notice}</Banner>}

          {!busy && !staged && (
            <EmptyState
              icon="🗂️"
              title="Nothing extracted yet"
              text="Paste a document on the left and hit Extract. You'll get a list of characters, locations, and props to review before anything is added."
            />
          )}

          {!busy && staged && proposed.length === 0 && (
            <EmptyState
              icon={addedCount > 0 ? "✅" : "🔍"}
              title={addedCount > 0 ? "Review queue clear" : "No new entries found"}
              text={
                addedCount > 0
                  ? `${addedCount} ${addedCount === 1 ? "entry" : "entries"} added to your World Book. Paste another document to keep going.`
                  : "Everything in that document either already exists in your World Book or wasn't specific enough to extract."
              }
            />
          )}

          {visible.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {visible.map((item) => (
                <ProposalCard
                  key={item.id}
                  item={item}
                  busy={pendingIds.includes(item.id)}
                  onApprove={(i) => approve([i])}
                  onReject={reject}
                />
              ))}
            </div>
          )}
        </div>

        {staged?.matches?.length > 0 && (
          <div className="card">
            <div className="section-label">Already in your World Book ({staged.matches.length})</div>
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 12, lineHeight: 1.6 }}>
              These names already exist, so they were left alone. Compare the two versions and edit
              the entry yourself if the document adds something worth keeping.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {staged.matches.map((m, i) => (
                <div key={i} style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 8 }}>{m.existing.title}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 11.5, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>In your World Book</div>
                      <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-dim)" }}>{m.existing.content}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11.5, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>In this document</div>
                      <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-dim)" }}>{m.extracted.content}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(staged?.timelineMarkers?.length > 0 || staged?.relationships?.length > 0) && (
          <div className="card">
            {staged.timelineMarkers.length > 0 && (
              <>
                <div className="section-label">Timeline markers</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: staged.relationships.length ? 18 : 0 }}>
                  {staged.timelineMarkers.map((t, i) => (
                    <Tag key={i}>“{t.phrase}” → {t.resolvedEra || "unmapped"}</Tag>
                  ))}
                </div>
              </>
            )}
            {staged.relationships.length > 0 && (
              <>
                <div className="section-label">Relationships</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {staged.relationships.map((r, i) => (
                    <div key={i} style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
                      <strong style={{ color: "var(--text)" }}>{r.a}</strong>
                      {" ↔ "}
                      <strong style={{ color: "var(--text)" }}>{r.b}</strong>
                      {r.context ? ` — ${r.context}` : ""}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <style>{`@media (max-width: 1000px) { #import-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
