import { useState, useMemo, useEffect } from "react";
import { exportDocument, downloadExport, listExportHistory, deleteExportVersion } from "../lib/api";
import { Btn, Busy, Banner, EmptyState } from "../components/ui";
import { IconDocument, IconSearch, IconChevronDown, IconClock, IconClose, IconTrash } from "../components/Icons";
import { parseMarkdownBlocks, inlineRuns, parseFountain } from "../lib/docRender";
import { diffParagraphs, summarizeDiff } from "../lib/diff";

// Document type definitions — keys must match backend/export.py DOC_TYPES.
// Labels match how these documents are actually named in the industry
// (cross-checked against real shooting scripts / schedules / a character
// bios one-sheet), and each lists which file formats actually make sense
// for it — Fountain (the industry-standard plain-text screenplay
// interchange format) only applies to a screenplay-formatted document.
const DOC_TYPES = [
  {
    id: "characters",
    label: "Character Bios",
    assetType: "character",
    emptyLabel: "character",
    hint: "Prose bios for every character in your World Book, reading like a real production one-sheet.",
    formats: ["pdf", "docx", "markdown"],
  },
  {
    id: "locations",
    label: "Location Breakdown",
    assetType: "location",
    emptyLabel: "location",
    hint: "Every location in your World Book, grouped by era.",
    formats: ["pdf", "docx", "markdown"],
  },
  {
    id: "beats",
    label: "Beat Sheet",
    assetType: null,
    emptyLabel: "canon",
    hint: "A scene-by-scene outline spanning your whole timeline.",
    formats: ["pdf", "docx", "markdown"],
  },
  {
    id: "pitch",
    label: "Pitch Packet",
    assetType: null,
    emptyLabel: "canon",
    hint: "A shareable one-sheet summarizing your world for a producer or collaborator.",
    formats: ["pdf", "docx", "markdown"],
  },
  {
    id: "script",
    label: "Sample Scene",
    assetType: null,
    emptyLabel: "canon",
    hint: "One scene from your world, drafted in real screenplay format: a proof-of-concept page to hand someone.",
    formats: ["pdf", "fountain", "docx"],
  },
];

const FORMATS = {
  pdf: { label: "PDF" },
  docx: { label: "Word (.docx)" },
  fountain: { label: "Fountain (.fountain)" },
  markdown: { label: "Markdown (.md)" },
};

// ---- Version history helpers ------------------------------------------------
// Every Generate compiles a new snapshot server-side (see backend/main.py's
// export_document -> db.create_export_version); this module just displays
// that history. Versions are labeled with real shooting-script revision-page
// colors (white draft, then blue/pink/yellow/... in the order productions
// actually use them) instead of generic "v1/v2/v3" — a naming scheme a
// screenwriter or AD already reads at a glance.

const REVISION_COLORS = [
  { name: "White", hex: "#F5F4F2", text: "#3A3A38" },
  { name: "Blue", hex: "#CFE0F2", text: "#1F3A5C" },
  { name: "Pink", hex: "#F3D2DA", text: "#7A2E42" },
  { name: "Yellow", hex: "#F5EBB0", text: "#6B5A12" },
  { name: "Green", hex: "#CFE6D0", text: "#2E5233" },
  { name: "Goldenrod", hex: "#E9CE8C", text: "#5C4614" },
  { name: "Buff", hex: "#E9DCC3", text: "#5A4A2E" },
  { name: "Salmon", hex: "#F0C9B8", text: "#7A3B23" },
  { name: "Cherry", hex: "#E3B6BE", text: "#6E1F30" },
];

function revisionInfo(indexFromOldest) {
  const cycle = Math.floor(indexFromOldest / REVISION_COLORS.length);
  const color = REVISION_COLORS[indexFromOldest % REVISION_COLORS.length];
  const label = cycle === 0 ? color.name : `${color.name} · rev ${cycle + 1}`;
  return { ...color, label };
}

function relativeTime(ts) {
  const diffMs = Date.now() - ts;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Renders a paragraph-level redline between two versions of a document —
// cut paragraphs struck through, added ones highlighted, unchanged ones
// dimmed to keep focus on what actually moved between drafts.
function DiffView({ oldText, newText }) {
  const ops = useMemo(() => diffParagraphs(oldText, newText), [oldText, newText]);
  const { added, removed, changed } = useMemo(() => summarizeDiff(ops), [ops]);
  const summaryParts = [];
  if (changed) summaryParts.push(`${changed} reworded`);
  if (added) summaryParts.push(`${added} added`);
  if (removed) summaryParts.push(`${removed} cut`);

  return (
    <div className="export-diff">
      <div className="export-diff-summary">
        {summaryParts.length ? summaryParts.join(" · ") : "No changes between these two versions."}
      </div>
      <div className="export-diff-body">
        {ops.map((op, i) => (
          <p key={i} className={`export-diff-p export-diff-${op.type}`}>{op.text}</p>
        ))}
      </div>
    </div>
  );
}

// ---- Document preview renderers --------------------------------------------
// These turn the compiled text into an actual document-style preview instead
// of a raw monospace dump, so what's on screen reads like the file you're
// about to download rather than its source markup.

function MarkdownDoc({ text }) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);
  const out = [];
  let liBuf = [];
  const flushLi = (key) => {
    if (liBuf.length) {
      out.push(
        <ul key={`ul-${key}`} style={{ margin: "0 0 16px", paddingLeft: 22 }}>
          {liBuf.map((t, j) => (
            <li key={j} style={{ marginBottom: 5, lineHeight: 1.65 }}>
              {inlineRuns(t).map((r) => (r.bold ? <b key={r.key}>{r.text}</b> : <span key={r.key}>{r.text}</span>))}
            </li>
          ))}
        </ul>
      );
      liBuf = [];
    }
  };
  blocks.forEach((b, idx) => {
    if (b.type === "li") { liBuf.push(b.text); return; }
    flushLi(idx);
    if (b.type === "h1") {
      out.push(<h1 key={idx} style={{ fontFamily: "var(--font-display)", fontSize: 27, fontWeight: 600, marginTop: idx === 0 ? 0 : 30, marginBottom: 10 }}>{b.text}</h1>);
    } else if (b.type === "h2") {
      out.push(<h2 key={idx} style={{ fontFamily: "var(--font-display)", fontSize: 18.5, fontWeight: 600, marginTop: 24, marginBottom: 8 }}>{b.text}</h2>);
    } else if (b.type === "h3") {
      out.push(<h3 key={idx} style={{ fontFamily: "var(--font-display)", fontSize: 15.5, fontWeight: 600, marginTop: 20, marginBottom: 6 }}>{b.text}</h3>);
    } else if (b.type === "quote") {
      out.push(<p key={idx} style={{ fontStyle: "italic", color: "var(--danger)", fontSize: 13.5, margin: "0 0 16px" }}>{b.text}</p>);
    } else if (b.type === "p") {
      out.push(
        <p key={idx} style={{ margin: "0 0 15px", lineHeight: 1.75, fontSize: 15 }}>
          {inlineRuns(b.text).map((r) => (r.bold ? <b key={r.key}>{r.text}</b> : <span key={r.key}>{r.text}</span>))}
        </p>
      );
    }
  });
  flushLi("end");
  return <>{out}</>;
}

function ScriptDoc({ text }) {
  const { titlePage, blocks } = useMemo(() => parseFountain(text), [text]);
  return (
    <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 13.5, lineHeight: 1.7 }}>
      <div style={{ textAlign: "center", marginBottom: 44 }}>
        <div style={{ fontWeight: 700, marginBottom: 16, letterSpacing: "0.02em" }}>{titlePage.title || "UNTITLED"}</div>
        {titlePage.credit && <div>{titlePage.credit}</div>}
        {(titlePage.author || titlePage.authors) && <div>{titlePage.author || titlePage.authors}</div>}
        {titlePage["draft date"] && (
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-faint)" }}>{titlePage["draft date"]}</div>
        )}
      </div>
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          return <div key={i} style={{ fontWeight: 700, marginTop: 24, marginBottom: 12 }}>{b.text}</div>;
        }
        if (b.type === "transition") {
          return <div key={i} style={{ textAlign: "right", marginBottom: 12, marginTop: 12 }}>{b.text}</div>;
        }
        if (b.type === "dialogue") {
          return (
            <div key={i} style={{ maxWidth: 360, margin: "0 auto 16px" }}>
              <div style={{ textAlign: "center", fontWeight: 700 }}>{b.character}</div>
              {b.parenthetical && <div style={{ textAlign: "center", fontStyle: "italic", fontSize: 12.5 }}>{b.parenthetical}</div>}
              <div style={{ textAlign: "center" }}>{b.text}</div>
            </div>
          );
        }
        return <div key={i} style={{ marginBottom: 14 }}>{b.text}</div>;
      })}
    </div>
  );
}

export default function Export({ world, assets }) {
  const [docTypeId, setDocTypeId] = useState("characters");
  const [era, setEra] = useState("");
  const [faction, setFaction] = useState("");
  const [refineOpen, setRefineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadingFmt, setDownloadingFmt] = useState("");
  const [result, setResult] = useState(null); // last API response
  const [error, setError] = useState("");

  // Version history — every Generate snapshots server-side (see
  // backend/main.py's export_document), so this is just a window onto that.
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState(null);
  const [expandedMode, setExpandedMode] = useState("view"); // "view" | "diff"
  const [historyBusyKey, setHistoryBusyKey] = useState(""); // `${versionId}:${action}` in flight

  const docTypeDef = DOC_TYPES.find((d) => d.id === docTypeId);

  // Keep history (and its badge count on the History button) in sync with
  // whichever doc type is selected, so switching tabs never shows stale data.
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError("");
    listExportHistory(world.id, docTypeId)
      .then((h) => { if (!cancelled) setHistory(h); })
      .catch((e) => { if (!cancelled) setHistoryError(`Couldn't load version history: ${e.message}`); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    setExpandedVersionId(null);
    return () => { cancelled = true; };
  }, [docTypeId, world.id]);

  // Distinct non-"—" affiliation values from assets matching the current docType.
  // ("faction" is the underlying field name -- kept as-is in code/data since
  // it's just a free-text affiliation tag, not every world calls it a "faction".)
  // When assetType is null (beats/pitch/script) collect from ALL assets.
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
      // A successful (non-empty) compile just snapshotted a new version
      // server-side — refresh the history list/badge so it shows up without
      // needing to reopen the panel.
      if (!res.empty) {
        listExportHistory(world.id, docTypeId).then(setHistory).catch(() => {});
      }
    } catch (e) {
      setError(`Generation failed: ${e.message}`);
    }
    setBusy(false);
  }

  const content = result?.markdown || ""; // Markdown for most types; Fountain text for "script"

  // Shared by the current-result download row and every history row's
  // download row — just varies which text/count it's converting.
  async function performDownload(format, text, assetCount) {
    const { blob, filename } = await downloadExport(world.id, {
      docType: docTypeId, format, content: text, assetCount,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function download(format) {
    if (!content) return;
    setDownloadingFmt(format);
    setError("");
    try {
      await performDownload(format, content, result?.assetCount || 0);
    } catch (e) {
      setError(`Download failed: ${e.message}`);
    }
    setDownloadingFmt("");
  }

  function restoreVersion(v) {
    setResult({ markdown: v.content, docType: v.docType, assetCount: v.assetCount, generatedAt: v.createdAt, offline: v.offline });
    setEra(v.era || "");
    setFaction(v.faction || "");
    setError("");
    setHistoryOpen(false);
  }

  async function downloadHistoryVersion(v, format) {
    const key = `${v.id}:${format}`;
    setHistoryBusyKey(key);
    setHistoryError("");
    try {
      await performDownload(format, v.content, v.assetCount);
    } catch (e) {
      setHistoryError(`Download failed: ${e.message}`);
    }
    setHistoryBusyKey("");
  }

  async function deleteVersion(v) {
    setHistoryBusyKey(`${v.id}:delete`);
    setHistoryError("");
    try {
      await deleteExportVersion(world.id, v.id);
      setHistory((prev) => prev.filter((h) => h.id !== v.id));
      if (expandedVersionId === v.id) setExpandedVersionId(null);
    } catch (e) {
      setHistoryError(`Couldn't delete version: ${e.message}`);
    }
    setHistoryBusyKey("");
  }

  const eras = world?.eras || [];
  const hasFilters = era || faction;
  const activeFilterCount = [era, faction].filter(Boolean).length;
  const isEmpty = result?.empty;
  const isOffline = result?.offline;
  const showRefine = docTypeId !== "beats"; // backend ignores era/faction for beats

  return (
    <div className="fade-in export-screen">
      <div className="export-head">
        <h1 style={{ fontSize: 28 }}>Export</h1>
        <p>
          Turn your world's canon into production-ready documents. Pick a type,
          generate it, then export it in the format your team actually uses.
        </p>
      </div>

      <div className="export-toolbar">
        <div className="export-doctypes">
          {DOC_TYPES.map((dt) => (
            <button
              key={dt.id}
              type="button"
              className={`export-doctype-tab ${docTypeId === dt.id ? "active" : ""}`}
              onClick={() => pickDocType(dt.id)}
              title={dt.hint}
            >
              {dt.label}
            </button>
          ))}
        </div>

        <div className="export-toolbar-right">
          <button
            type="button"
            className="export-history-toggle"
            onClick={() => setHistoryOpen(true)}
            title="See past versions of this document type"
          >
            <IconClock width={13} height={13} />
            History{history.length > 0 ? ` · ${history.length}` : ""}
          </button>
          {showRefine && (
            <button type="button" className="export-refine-toggle" onClick={() => setRefineOpen((v) => !v)}>
              Refine{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
              <IconChevronDown width={13} height={13} style={{ transform: refineOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
            </button>
          )}
          <Btn variant="primary" onClick={generate} disabled={busy} title="Compile the selected document type">
            Generate
          </Btn>
        </div>
      </div>

      {showRefine && refineOpen && (
        <div className="export-refine-row">
          <label>
            <span>Era</span>
            <select
              className="export-select"
              value={era}
              onChange={(e) => { setEra(e.target.value); setResult(null); }}
              title="Only include entries from this era"
            >
              <option value="">All eras</option>
              {eras.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Affiliation</span>
            <select
              className="export-select"
              value={faction}
              onChange={(e) => { setFaction(e.target.value); setResult(null); }}
              title="Only include entries with this affiliation"
            >
              <option value="">All affiliations</option>
              {factionOptions.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="export-preview-head">
        <div>
          <div className="export-preview-label">{docTypeDef.label}</div>
          <div className="export-preview-sub">
            {result && !isEmpty
              ? `${result.assetCount} ${result.assetCount === 1 ? "entry" : "entries"} compiled${hasFilters ? " · filtered" : ""}`
              : docTypeDef.hint}
          </div>
        </div>
        {content && !isEmpty && (
          <div className="export-format-row">
            {docTypeDef.formats.map((f) => (
              <button
                key={f}
                type="button"
                className="export-format-chip"
                onClick={() => download(f)}
                disabled={!!downloadingFmt}
                title={`Download this document as ${FORMATS[f].label}`}
              >
                {downloadingFmt === f ? "Preparing…" : FORMATS[f].label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="doc-page">
        {busy && <Busy label="Compiling your world's entries into a document…" />}

        {error && <Banner tone="danger">{error}</Banner>}

        {isOffline && (
          <Banner tone="danger">
            watsonx was unreachable, so this document was built directly from your
            canon fields without prose generation. Re-generate when the service is
            back for a polished version.
          </Banner>
        )}

        {!busy && !result && !error && (
          <EmptyState
            icon={IconDocument}
            title="Nothing generated yet"
            text={`Pick a document type${eras.length > 0 ? ", optionally refine by era or affiliation," : ""} and hit Generate.`}
          />
        )}

        {!busy && isEmpty && (
          <EmptyState
            icon={IconSearch}
            title={`No ${docTypeDef.emptyLabel} entries match those filters yet`}
            text={`Try removing the era or affiliation filter, or add some ${docTypeDef.emptyLabel} assets to your World Book first.`}
          />
        )}

        {!busy && content && !isEmpty && (
          docTypeId === "script" ? <ScriptDoc text={content} /> : <MarkdownDoc text={content} />
        )}
      </div>

      {historyOpen && (
        <div className="export-history-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="export-history-panel" onClick={(e) => e.stopPropagation()}>
            <div className="export-history-head">
              <div>
                <div className="export-history-title">Version History</div>
                <div className="export-history-subtitle">
                  {docTypeDef.label} · {history.length} {history.length === 1 ? "version" : "versions"}
                </div>
              </div>
              <button type="button" className="icon-btn" title="Close" onClick={() => setHistoryOpen(false)}>
                <IconClose width={16} height={16} />
              </button>
            </div>

            {historyLoading && <Busy label="Loading past versions…" />}
            {historyError && <Banner tone="danger">{historyError}</Banner>}

            {!historyLoading && !historyError && history.length === 0 && (
              <EmptyState
                icon={IconClock}
                title="No versions yet"
                text="Every time you hit Generate, this document is saved as a version here — so you can page back through earlier drafts, see what changed between them, or restore one."
              />
            )}

            {!historyLoading && history.length > 0 && (
              <div className="export-history-list">
                {history.map((v, idx) => {
                  // history[] is newest-first; index-from-oldest drives the
                  // revision-color assignment (oldest = White draft).
                  const indexFromOldest = history.length - 1 - idx;
                  const rev = revisionInfo(indexFromOldest);
                  const older = history[idx + 1]; // chronologically previous version, if any
                  const isExpanded = expandedVersionId === v.id;
                  const filterLabel = v.era || v.faction
                    ? [v.era, v.faction].filter(Boolean).join(" · ")
                    : "All eras · all affiliations";

                  return (
                    <div key={v.id} className={`export-history-row ${isExpanded ? "expanded" : ""}`}>
                      <button
                        type="button"
                        className="export-history-row-head"
                        onClick={() => { setExpandedVersionId(isExpanded ? null : v.id); setExpandedMode("view"); }}
                      >
                        <span className="export-history-swatch" style={{ background: rev.hex, color: rev.text }}>
                          {rev.label}
                        </span>
                        <span className="export-history-row-main">
                          <span className="export-history-row-top">
                            <span className="export-history-time" title={new Date(v.createdAt).toLocaleString()}>
                              {relativeTime(v.createdAt)}
                            </span>
                            {idx === 0 && <span className="export-history-badge current">Current</span>}
                            {v.offline && <span className="export-history-badge offline">Offline draft</span>}
                          </span>
                          <span className="export-history-row-meta">
                            {v.assetCount} {v.assetCount === 1 ? "entry" : "entries"} · {filterLabel}
                          </span>
                        </span>
                        <IconChevronDown
                          width={13} height={13}
                          style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform .15s ease", flexShrink: 0, color: "var(--text-faint)" }}
                        />
                      </button>

                      {isExpanded && (
                        <div className="export-history-row-body">
                          <div className="export-history-row-tabs">
                            <button
                              type="button"
                              className={expandedMode === "view" ? "active" : ""}
                              onClick={() => setExpandedMode("view")}
                            >
                              Full text
                            </button>
                            {older && (
                              <button
                                type="button"
                                className={expandedMode === "diff" ? "active" : ""}
                                onClick={() => setExpandedMode("diff")}
                              >
                                What changed since {revisionInfo(indexFromOldest - 1).label}
                              </button>
                            )}
                          </div>

                          {expandedMode === "view" && (
                            <div className="export-history-doc">
                              {docTypeId === "script" ? <ScriptDoc text={v.content} /> : <MarkdownDoc text={v.content} />}
                            </div>
                          )}
                          {expandedMode === "diff" && older && (
                            <DiffView oldText={older.content} newText={v.content} />
                          )}

                          <div className="export-history-row-actions">
                            <Btn small onClick={() => restoreVersion(v)} title="Load this version into the main preview">
                              Restore this version
                            </Btn>
                            {docTypeDef.formats.map((f) => (
                              <button
                                key={f}
                                type="button"
                                className="export-format-chip"
                                disabled={!!historyBusyKey}
                                onClick={() => downloadHistoryVersion(v, f)}
                                title={`Download this version as ${FORMATS[f].label}`}
                              >
                                {historyBusyKey === `${v.id}:${f}` ? "Preparing…" : FORMATS[f].label}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="icon-btn export-history-delete"
                              title="Delete this version from history"
                              disabled={!!historyBusyKey}
                              onClick={() => deleteVersion(v)}
                            >
                              <IconTrash width={14} height={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .export-screen { display: flex; flex-direction: column; }

        .export-head p { color: var(--text-dim); font-size: 14.5px; line-height: 1.6; max-width: 640px; margin-top: 6px; }

        .export-toolbar {
          display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
          gap: 14px; margin-top: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border-soft);
        }
        .export-doctypes { display: flex; flex-wrap: wrap; gap: 6px; }
        .export-doctype-tab {
          font-family: var(--font-body); font-size: 13.5px; font-weight: 600;
          padding: 9px 16px; border-radius: 999px; border: 1px solid transparent;
          background: transparent; color: var(--text-dim); cursor: pointer; transition: all .12s ease;
        }
        .export-doctype-tab:hover { color: var(--text); background: var(--surface-hover); }
        .export-doctype-tab.active { background: var(--accent); color: var(--on-accent); }

        .export-toolbar-right { display: flex; align-items: center; gap: 14px; }
        .export-refine-toggle {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--font-body); font-size: 13px; font-weight: 500;
          color: var(--text-dim); background: transparent; border: none; cursor: pointer; padding: 8px 2px;
        }
        .export-refine-toggle:hover { color: var(--text); }

        .export-refine-row {
          display: flex; flex-wrap: wrap; gap: 28px; padding: 16px 2px 2px;
          animation: fadeIn 0.18s ease;
        }
        .export-refine-row label {
          display: flex; flex-direction: column; gap: 6px; font-size: 12px;
          color: var(--text-faint); min-width: 180px;
        }
        .export-select {
          font-family: var(--font-body); font-size: 13.5px; padding: 8px 2px;
          background: transparent; border: none; border-bottom: 1px solid var(--border);
          color: var(--text); outline: none; border-radius: 0; cursor: pointer;
        }
        .export-select:focus { border-color: var(--text); }

        .export-preview-head {
          display: flex; align-items: flex-end; justify-content: space-between;
          flex-wrap: wrap; gap: 12px; margin: 28px 0 16px;
        }
        .export-preview-label { font-family: var(--font-display); font-size: 20px; font-weight: 600; }
        .export-preview-sub { font-size: 12.5px; color: var(--text-faint); margin-top: 3px; }
        .export-format-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .export-format-chip {
          font-family: var(--font-body); font-size: 12.5px; font-weight: 600;
          padding: 8px 15px; border-radius: 7px; border: 1px solid var(--border);
          background: var(--raised); color: var(--text); cursor: pointer; transition: all .12s ease;
        }
        .export-format-chip:hover:not(:disabled) { border-color: var(--text-faint); background: var(--surface-hover); }
        .export-format-chip:disabled { opacity: .55; cursor: default; }

        /* Deliberate deviation from the app's theme-driven palette: this
           surface previews the document as it will actually print/export --
           paper -- so it stays a light "page" regardless of whether the app
           itself is in dark or light theme, the same way a word processor's
           dark mode still shows a white page. Re-declares this container's
           slice of the light theme's tokens (see :root[data-theme="light"]
           in global.css) as local custom properties, so shared primitives
           nested inside (Banner, EmptyState, Busy) automatically render in
           "paper" colors with no changes to those components themselves. */
        .doc-page {
          --bg-elevated: #FFFFFF; --surface: #FFFFFF; --surface-hover: #F1F0EF;
          --raised: #E7E6E5; --border: #C7C6C5; --border-soft: #D2D1D0;
          --text: #0A0A0A; --text-dim: #4B4B4A; --text-faint: #7A7A79;
          --accent: #0A0A0A; --accent-strong: #000000; --on-accent: #FFFFFF; --accent-soft: rgba(10,10,10,0.06);
          --danger: #8A4A42; --danger-soft: rgba(138,74,66,0.08);
          --ok: #4C6E52; --ok-soft: rgba(76,110,82,0.08);
          --font-display: 'Barlow Condensed', 'Arial Narrow', sans-serif;

          background: #FFFFFF;
          color: var(--text);
          border-radius: 3px;
          border: 1px solid var(--border-soft);
          box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 20px 48px rgba(0,0,0,0.22);
          padding: 64px 72px;
          max-width: 820px;
          margin: 0 auto;
          min-height: 62vh;
        }
        @media (max-width: 720px) {
          .doc-page { padding: 36px 22px; }
        }

        .export-history-toggle {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--font-body); font-size: 13px; font-weight: 500;
          color: var(--text-dim); background: transparent; border: none; cursor: pointer; padding: 8px 2px;
        }
        .export-history-toggle:hover { color: var(--text); }

        .export-history-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(3px);
          display: flex; align-items: center; justify-content: center; z-index: 100; padding: 40px 20px;
          animation: fadeIn .15s ease;
        }
        .export-history-panel {
          position: relative; background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius-lg);
          max-width: 720px; width: 100%; max-height: 86vh; overflow-y: auto; padding: 32px 36px; box-shadow: var(--shadow-lg);
        }
        .export-history-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
        .export-history-title { font-family: var(--font-display); font-size: 24px; font-weight: 600; }
        .export-history-subtitle { font-size: 12.5px; color: var(--text-faint); margin-top: 3px; }

        .export-history-list { display: flex; flex-direction: column; gap: 8px; }
        .export-history-row {
          border: 1px solid var(--border-soft); border-radius: var(--radius); overflow: hidden;
          transition: border-color .12s ease;
        }
        .export-history-row.expanded { border-color: var(--border); }

        .export-history-row-head {
          width: 100%; display: flex; align-items: center; gap: 12px; text-align: left;
          padding: 12px 14px; background: transparent; border: none; cursor: pointer;
          font-family: var(--font-body); color: var(--text); transition: background .12s ease;
        }
        .export-history-row-head:hover { background: var(--surface-hover); }

        .export-history-swatch {
          flex-shrink: 0; font-size: 10.5px; font-weight: 700; letter-spacing: .02em;
          padding: 4px 9px; border-radius: 999px; white-space: nowrap;
        }
        .export-history-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .export-history-row-top { display: flex; align-items: center; gap: 8px; }
        .export-history-time { font-size: 13.5px; font-weight: 600; }
        .export-history-badge {
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
          padding: 2px 7px; border-radius: 999px;
        }
        .export-history-badge.current { background: var(--accent-soft); color: var(--accent-strong); }
        .export-history-badge.offline { background: var(--danger-soft); color: var(--danger); }
        .export-history-row-meta { font-size: 12px; color: var(--text-faint); }

        .export-history-row-body { padding: 4px 14px 16px; border-top: 1px solid var(--border-soft); animation: fadeIn .15s ease; }
        .export-history-row-tabs { display: flex; gap: 4px; margin: 12px 0; }
        .export-history-row-tabs button {
          font-family: var(--font-body); font-size: 12.5px; font-weight: 600;
          padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border-soft);
          background: transparent; color: var(--text-dim); cursor: pointer; transition: all .12s ease;
        }
        .export-history-row-tabs button:hover { color: var(--text); border-color: var(--text-faint); }
        .export-history-row-tabs button.active { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }

        .export-history-doc {
          max-height: 340px; overflow-y: auto; padding: 18px 20px; border-radius: var(--radius-sm);
          background: var(--raised); font-size: 13px; line-height: 1.6;
        }
        .export-history-doc h1, .export-history-doc h2, .export-history-doc h3 { font-size: 1em; margin: 0 0 8px; }

        .export-history-row-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
        .export-history-delete { margin-left: auto; color: var(--danger); }
        .export-history-delete:hover:not(:disabled) { border-color: var(--danger); background: var(--danger-soft); }

        .export-diff {
          max-height: 380px; overflow-y: auto; border-radius: var(--radius-sm);
          background: var(--raised); padding: 16px 20px;
        }
        .export-diff-summary { font-size: 12px; font-weight: 600; color: var(--text-dim); margin-bottom: 10px; }
        .export-diff-body { font-size: 13.5px; line-height: 1.7; }
        .export-diff-p { margin: 0 0 10px; }
        .export-diff-same { color: var(--text-faint); }
        .export-diff-added { color: var(--ok); background: var(--ok-soft); padding: 6px 10px; border-radius: 6px; border-left: 2px solid var(--ok); }
        .export-diff-removed { color: var(--danger); background: var(--danger-soft); padding: 6px 10px; border-radius: 6px; border-left: 2px solid var(--danger); text-decoration: line-through; text-decoration-thickness: 1px; }

        @media (max-width: 640px) {
          .export-history-panel { padding: 24px 20px; }
        }
      `}</style>
    </div>
  );
}
