import { useState, useMemo } from "react";
import { exportDocument } from "../lib/api";
import { Btn, Chip, Busy, Banner, EmptyState } from "../components/ui";

// Document type definitions — keys must match backend/export.py DOC_TYPES
const DOC_TYPES = [
  {
    id: "characters",
    label: "Character breakdown sheet",
    assetType: "character",
    emptyLabel: "character",
    hint: "Compile a profile sheet for every character in your World Book",
  },
  {
    id: "locations",
    label: "Location list",
    assetType: "location",
    emptyLabel: "location",
    hint: "Compile a list of every location in your World Book",
  },
  {
    id: "beats",
    label: "Scene / beat outline",
    assetType: null,   // pulls all types; backend ignores era/faction for this type
    emptyLabel: "canon",
    hint: "Compile a scene-by-scene outline spanning your whole timeline",
  },
  {
    id: "pitch",
    label: "Pitch packet",
    assetType: null,   // pulls all types; era/faction filters apply normally
    emptyLabel: "canon",
    hint: "Compile a shareable pitch document summarizing your world",
  },
];

function downloadMarkdown(text, docTypeId) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${docTypeId}-export.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Export({ world, assets }) {
  const [docTypeId, setDocTypeId] = useState("characters");
  const [era, setEra] = useState("");
  const [faction, setFaction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // last API response
  const [error, setError] = useState("");

  const docTypeDef = DOC_TYPES.find((d) => d.id === docTypeId);

  // Distinct non-"—" faction values from assets matching the current docType.
  // When assetType is null (beats/pitch) collect from ALL assets.
  const factionOptions = useMemo(() => {
    if (!assets) return [];
    const relevant = docTypeDef.assetType
      ? assets.filter((a) => a.type === docTypeDef.assetType)
      : assets;
    const seen = new Set();
    const opts = [];
    for (const a of relevant) {
      const f = (a.faction || "").trim();
      if (f && f !== "—" && !seen.has(f)) {
        seen.add(f);
        opts.push(f);
      }
    }
    return opts.sort();
  }, [assets, docTypeDef]);

  // Reset filters when docType changes
  function pickDocType(id) {
    setDocTypeId(id);
    setEra("");
    setFaction("");
    setResult(null);
    setError("");
  }

  async function generate() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await exportDocument(world.id, { docType: docTypeId, era, faction });
      setResult(res);
    } catch (e) {
      setError(`Generation failed: ${e.message}`);
    }
    setBusy(false);
  }

  const eras = world?.eras || [];
  const hasFilters = era || faction;
  const isEmpty = result?.empty;
  const isOffline = result?.offline;
  const markdown = result?.markdown || "";

  return (
    <div
      className="fade-in"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 380px) minmax(0, 1fr)",
        gap: 28,
        alignItems: "start",
      }}
      id="export-grid"
    >
      {/* ── Left: controls ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <h1 style={{ fontSize: 25, marginBottom: 6 }}>Export</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14.5, lineHeight: 1.6 }}>
            Compile your world's canon assets into a production-ready Markdown
            document. Filter by era or faction to focus on a subset.
          </p>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Doc type picker */}
          <div>
            <div className="section-label">Document type</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {DOC_TYPES.map((dt) => (
                <Chip key={dt.id} active={docTypeId === dt.id} onClick={() => pickDocType(dt.id)} title={dt.hint}>
                  {dt.label}
                </Chip>
              ))}
            </div>
            {docTypeId === "beats" && (
              <p style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
                Scene/beat outlines always span every era in your world.
              </p>
            )}
          </div>

          {/* Era + faction filters — hidden for "beats" (backend ignores them) */}
          {docTypeId !== "beats" && (
            <>
              <div>
                <div className="section-label">Filter by era</div>
                <select
                  className="field"
                  value={era}
                  onChange={(e) => { setEra(e.target.value); setResult(null); }}
                  title="Only include entries from this era"
                  style={{ marginTop: 8 }}
                >
                  <option value="">All eras</option>
                  {eras.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="section-label">Filter by faction</div>
                <select
                  className="field"
                  value={faction}
                  onChange={(e) => { setFaction(e.target.value); setResult(null); }}
                  title="Only include entries from this faction"
                  style={{ marginTop: 8 }}
                >
                  <option value="">All factions</option>
                  {factionOptions.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <Btn
            variant="primary"
            onClick={generate}
            disabled={busy}
            title="Compile the selected document type into Markdown"
          >
            Generate
          </Btn>
        </div>

        {result && !isEmpty && (
          <p style={{ fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.6, margin: 0 }}>
            {result.assetCount} {result.assetCount === 1 ? "entry" : "entries"} compiled
            {hasFilters ? " (filtered)" : ""}.
          </p>
        )}
      </div>

      {/* ── Right: preview ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div
          className="card"
          style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 420 }}
        >
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              borderBottom: "1px solid var(--border-soft)",
              paddingBottom: 14,
            }}
          >
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600 }}>
                Preview
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 2 }}>
                {result
                  ? `${docTypeDef.label} · ${result.assetCount} ${result.assetCount === 1 ? "entry" : "entries"}`
                  : "Your compiled document will appear here."}
              </div>
            </div>
            {markdown && (
              <Btn
                small
                variant="primary"
                onClick={() => downloadMarkdown(markdown, docTypeId)}
                title="Download this document as a Markdown file"
              >
                Download .md
              </Btn>
            )}
          </div>

          {/* States */}
          {busy && <Busy label="Compiling your world's entries into a document…" />}

          {error && <Banner tone="danger">{error}</Banner>}

          {isOffline && (
            <Banner tone="danger">
              watsonx was unreachable — this document was built directly from your
              canon fields without prose generation. Re-generate when the service is
              back for a polished version.
            </Banner>
          )}

          {!busy && !result && !error && (
            <EmptyState
              icon="📄"
              title="Nothing generated yet"
              text={`Pick a document type${eras.length > 0 ? ", optionally filter by era or faction," : ""} and hit Generate.`}
            />
          )}

          {!busy && isEmpty && (
            <EmptyState
              icon="🔍"
              title={`No ${docTypeDef.emptyLabel} entries match those filters yet`}
              text={`Try removing the era or faction filter, or add some ${docTypeDef.emptyLabel} assets to your World Book first.`}
            />
          )}

          {!busy && markdown && (
            <pre
              style={{
                margin: 0,
                fontFamily: "var(--font-mono, 'Courier New', monospace)",
                fontSize: 13,
                lineHeight: 1.7,
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowY: "auto",
                maxHeight: "70vh",
              }}
            >
              {markdown}
            </pre>
          )}
        </div>
      </div>

      <style>{`@media (max-width: 960px) { #export-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
