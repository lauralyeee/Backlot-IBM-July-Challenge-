import { useState, useMemo, useRef, useEffect } from "react";
import {
  ingestText, ingestFile, commitIngested, updateIngestedAsset,
  listDocuments, commitRelationships,
} from "../lib/api";
import { TYPE_META } from "../lib/worldData";
import { Field, Btn, Chip, Busy, Banner, Tag, EmptyState } from "../components/ui";
import {
  IconSpark, IconImport, IconFolder, IconCheck, IconSearch, TypeIcon,
  IconEdit, IconClock, IconChevronDown, IconChevronUp,
} from "../components/Icons";

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
  { id: "event", label: "Events" },
];

// Left accent bar per type -- monochrome, so differentiated by weight
// rather than hue (the type icon on each card carries the rest).
const ACCENT = {
  character: "var(--text)",
  location: "var(--text-dim)",
  lore: "var(--text-faint)",
  event: "var(--text-dim)",
};

// Mirrors backend/ingestion.py's SUPPORTED_UPLOAD_EXTENSIONS split -- kept
// as two sets client-side so drag-and-drop can validate a dropped file the
// same way the file picker's `accept` attribute does, and so the busy
// label/pipeline badge can tell which path (Docling vs. plain text) a given
// upload will take before the response comes back.
const DOCLING_EXTENSIONS = new Set([".pdf", ".docx"]);
const PLAIN_TEXT_EXTENSIONS = new Set([".txt", ".fountain"]);

// Mirrors backend/ingestion.py's MAX_CHUNK_CHARS (estimate only -- real
// chunk boundaries are computed server-side, this is just used to pick a
// more informative busy label before the response comes back).
const LONG_DOCUMENT_CHARS = 6000;

function extOf(filename) {
  const i = (filename || "").lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

function ProposalCard({ item, onApprove, onReject, busy, editing, draft, onStartEdit, onEditField, onSaveEdit, onCancelEdit }) {
  const meta = TYPE_META[item.type] || { label: item.type };

  if (editing && draft) {
    return (
      <div
        className="card fade-in"
        style={{
          borderLeft: `3px solid ${ACCENT[item.type] || "var(--accent)"}`,
          display: "flex", flexDirection: "column", gap: 10,
        }}
      >
        <Field value={draft.title} onChange={(e) => onEditField("title", e.target.value)} placeholder="Title" />
        <Field area rows={4} value={draft.content} onChange={(e) => onEditField("content", e.target.value)} placeholder="Content" />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Field value={draft.era} onChange={(e) => onEditField("era", e.target.value)} placeholder="Era" style={{ flex: 1, minWidth: 90 }} />
          <Field value={draft.faction} onChange={(e) => onEditField("faction", e.target.value)} placeholder="Faction" style={{ flex: 1, minWidth: 90 }} />
          <Field value={draft.mood} onChange={(e) => onEditField("mood", e.target.value)} placeholder="Mood" style={{ flex: 1, minWidth: 90 }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small variant="primary" onClick={onSaveEdit}>Save</Btn>
          <Btn small onClick={onCancelEdit}>Cancel</Btn>
        </div>
      </div>
    );
  }

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
          <TypeIcon type={item.type} width={15} height={15} style={{ color: "var(--text-dim)" }} />
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn small variant="primary" disabled={busy} onClick={() => onApprove(item)} title="Add this entry to your World Book">Add to World Book</Btn>
        <Btn small disabled={busy} onClick={() => onStartEdit(item)} title="Edit this entry before adding it">
          <IconEdit width={13} height={13} /> Edit
        </Btn>
        <Btn small disabled={busy} onClick={() => onReject(item)} title="Discard this proposed entry">Discard</Btn>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="card" style={{ padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: color || "var(--text)" }}>{value}</div>
    </div>
  );
}

export default function Import({ world, addAsset }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Reading the document and pulling out entries…");
  const [pipelineMode, setPipelineMode] = useState(null); // "docling" | "text" | null
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [staged, setStaged] = useState(null);      // full ingest response
  const [proposed, setProposed] = useState([]);    // not-yet-approved entries
  const [addedCount, setAddedCount] = useState(0);
  const [filter, setFilter] = useState("all");
  const [pendingIds, setPendingIds] = useState([]);
  const [pendingMatchIds, setPendingMatchIds] = useState([]);
  const [pendingRelIds, setPendingRelIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pastImports, setPastImports] = useState([]);
  const [pastImportsOpen, setPastImportsOpen] = useState(false);
  const [expandedImportId, setExpandedImportId] = useState(null);
  const fileInputRef = useRef(null);

  const counts = useMemo(() => ({
    total: proposed.length,
    character: proposed.filter((p) => p.type === "character").length,
    location: proposed.filter((p) => p.type === "location").length,
  }), [proposed]);

  const visible = filter === "all" ? proposed : proposed.filter((p) => p.type === filter);

  function refreshPastImports() {
    listDocuments(world.id).then(setPastImports).catch(() => {});
  }

  useEffect(() => {
    refreshPastImports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id]);

  // Accepts overrides so a past import can be re-run without waiting on
  // React's async state update to land (setTitle/setText are async).
  async function extract(overrideText, overrideTitle) {
    const t = overrideText ?? text;
    const ti = overrideTitle ?? title;
    if (!t.trim()) return;
    setBusy(true); setError(""); setNotice(""); setStaged(null); setProposed([]); setAddedCount(0);
    setPipelineMode("text");
    setBusyLabel(
      t.length > LONG_DOCUMENT_CHARS
        ? "Long document — extracting in sections, this can take a bit longer…"
        : "Reading the document and pulling out entries…"
    );
    try {
      const res = await ingestText(world.id, { text: t, title: ti });
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

  // Docling (or plain-text) companion path: same staging as extract() above,
  // but the source text comes from an uploaded file instead of the paste
  // box. Selecting/dropping a file triggers extraction immediately.
  async function extractFromFile(file) {
    if (!file) return;
    const ext = extOf(file.name);
    const usesDocling = DOCLING_EXTENSIONS.has(ext);
    setBusy(true); setError(""); setNotice(""); setStaged(null); setProposed([]); setAddedCount(0);
    setPipelineMode(usesDocling ? "docling" : "text");
    setBusyLabel(
      usesDocling
        ? "Parsing with Docling — first run can take a bit longer…"
        : "Reading the file and pulling out entries…"
    );
    try {
      const res = await ingestFile(world.id, file, title || file.name);
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

  function onFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so selecting the same file again still fires onChange
    if (file) extractFromFile(file);
  }

  function onDragOverZone(e) {
    e.preventDefault();
    if (!busy) setIsDragOver(true);
  }

  function onDragLeaveZone(e) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function onDropFile(e) {
    e.preventDefault();
    setIsDragOver(false);
    if (busy) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const ext = extOf(file.name);
    if (!DOCLING_EXTENSIONS.has(ext) && !PLAIN_TEXT_EXTENSIONS.has(ext)) {
      setError(`Unsupported file type '${ext || "unknown"}' — drop a PDF, DOCX, TXT, or Fountain file.`);
      return;
    }
    extractFromFile(file);
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
      refreshPastImports();
    } catch (e) {
      setError(`Couldn't add: ${e.message}`);
    }
    setPendingIds((prev) => prev.filter((id) => !ids.includes(id)));
  }

  function reject(item) {
    setProposed((prev) => prev.filter((p) => p.id !== item.id));
  }

  function discardAll(items) {
    const ids = items.map((i) => i.id);
    setProposed((prev) => prev.filter((p) => !ids.includes(p.id)));
    if (editingId && ids.includes(editingId)) { setEditingId(null); setEditDraft(null); }
  }

  function startEdit(item) { setEditingId(item.id); setEditDraft({ ...item }); }
  function editField(field, value) { setEditDraft((prev) => (prev ? { ...prev, [field]: value } : prev)); }
  function saveEdit() {
    if (!editDraft) return;
    const id = editingId;
    setProposed((prev) => prev.map((p) => (p.id === id ? { ...editDraft } : p)));
    setEditingId(null); setEditDraft(null);
  }
  function cancelEdit() { setEditingId(null); setEditDraft(null); }

  async function updateExisting(match) {
    setPendingMatchIds((prev) => [...prev, match.existing.id]);
    setError("");
    try {
      const res = await updateIngestedAsset(world.id, match.existing.id, staged.document, match.extracted);
      addAsset(res.updated);
      setStaged((prev) => ({ ...prev, matches: prev.matches.filter((m) => m.existing.id !== match.existing.id) }));
      setNotice(`"${res.updated.title}" updated from this document.`);
      refreshPastImports();
    } catch (e) {
      setError(`Couldn't update: ${e.message}`);
    }
    setPendingMatchIds((prev) => prev.filter((id) => id !== match.existing.id));
  }

  async function mergeExisting(match) {
    setPendingMatchIds((prev) => [...prev, match.existing.id]);
    setError("");
    try {
      const mergedItem = { ...match.extracted, content: `${match.existing.content}\n\n${match.extracted.content}` };
      const res = await updateIngestedAsset(world.id, match.existing.id, staged.document, mergedItem);
      addAsset(res.updated);
      setStaged((prev) => ({ ...prev, matches: prev.matches.filter((m) => m.existing.id !== match.existing.id) }));
      setNotice(`"${res.updated.title}" merged with this document's version.`);
      refreshPastImports();
    } catch (e) {
      setError(`Couldn't merge: ${e.message}`);
    }
    setPendingMatchIds((prev) => prev.filter((id) => id !== match.existing.id));
  }

  async function approveRelationships(rels) {
    const ids = rels.map((r) => r.id);
    setPendingRelIds((prev) => [...prev, ...ids]);
    setError("");
    try {
      const res = await commitRelationships(world.id, staged.document, rels);
      setStaged((prev) => ({ ...prev, relationships: prev.relationships.filter((r) => !ids.includes(r.id)) }));
      setNotice(res.created.length === 1 ? "Saved 1 relationship." : `Saved ${res.created.length} relationships.`);
      refreshPastImports();
    } catch (e) {
      setError(`Couldn't save: ${e.message}`);
    }
    setPendingRelIds((prev) => prev.filter((id) => !ids.includes(id)));
  }

  function rerunPastImport(doc) {
    setTitle(doc.title);
    setText(doc.rawText);
    setPastImportsOpen(false);
    extract(doc.rawText, doc.title);
  }

  return (
    <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "minmax(0, 420px) minmax(0, 1fr)", gap: 28 }} id="import-grid">
      {/* ── Left: source document ─────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <h1 style={{ fontSize: 28, marginBottom: 6 }}>Import</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14.5, lineHeight: 1.6 }}>
            Start from something you’ve already written. Paste a script, treatment,
            or outline and it’s broken down into entries you can review one by one.
          </p>
        </div>

        <div
          className="card"
          onDragOver={onDragOverZone}
          onDragLeave={onDragLeaveZone}
          onDrop={onDropFile}
          style={isDragOver ? { borderColor: "var(--text)", borderStyle: "dashed" } : undefined}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="section-label" style={{ marginBottom: 0 }}>Source document</div>
            <Btn small variant="ghost" onClick={() => { setText(SAMPLE_SCRIPT); setTitle("Sample scene"); }} title="Fill the box with an example scene to try extraction">
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
            placeholder="Paste your script, treatment, outline, or pitch doc here… or drop a PDF, DOCX, TXT, or Fountain file anywhere on this card."
            style={{ fontSize: 13.5, lineHeight: 1.6 }}
          />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14 }}>
            <Btn variant="primary" onClick={() => extract()} disabled={busy || !text.trim()} title="Read the document and propose new World Book entries">
              <IconSpark width={16} height={16} /> Extract entries
            </Btn>
            {text.trim() && (
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
                {text.trim().split(/\s+/).length.toLocaleString()} words
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
            <span style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Btn small variant="ghost" disabled={busy} onClick={() => fileInputRef.current?.click()} title="Upload a file to extract entries from (PDF/DOCX parsed by IBM Docling; TXT/Fountain read directly), or drag one onto this card">
              <IconImport width={15} height={15} /> Upload PDF, DOCX, TXT, or Fountain
            </Btn>
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
              PDF/DOCX parsed by IBM Docling; TXT/Fountain read directly — either way, extracted the same way as pasted text.
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.fountain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={onFileSelected}
            style={{ display: "none" }}
          />
        </div>

        <div className="card" style={{ padding: 0 }}>
          <button
            type="button"
            onClick={() => setPastImportsOpen((v) => !v)}
            title="Show documents you've previously extracted from"
            style={{
              width: "100%", background: "none", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: 14, color: "var(--text)", fontSize: 14,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <IconClock width={14} height={14} /> Past imports {pastImports.length > 0 && `(${pastImports.length})`}
            </span>
            {pastImportsOpen ? <IconChevronUp width={14} height={14} /> : <IconChevronDown width={14} height={14} />}
          </button>
          {pastImportsOpen && (
            <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {pastImports.length === 0 && (
                <p style={{ fontSize: 12.5, color: "var(--text-faint)", margin: 0 }}>Nothing extracted yet — your past imports will show up here.</p>
              )}
              {pastImports.map((doc) => (
                <div key={doc.id} style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{doc.title}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{new Date(doc.createdAt).toLocaleString()}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn small onClick={() => setExpandedImportId((id) => (id === doc.id ? null : doc.id))} title="Preview the raw text of this document">
                        {expandedImportId === doc.id ? "Hide" : "Preview"}
                      </Btn>
                      <Btn small disabled={busy} onClick={() => rerunPastImport(doc)} title="Re-run extraction on this document">
                        Re-extract
                      </Btn>
                    </div>
                  </div>
                  {expandedImportId === doc.id && (
                    <pre style={{
                      marginTop: 10, fontSize: 12, lineHeight: 1.5, color: "var(--text-dim)",
                      whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 220, overflowY: "auto",
                      background: "var(--bg-elevated)", padding: 10, borderRadius: "var(--radius)",
                    }}>
                      {(doc.rawText || "").slice(0, 2000)}
                      {(doc.rawText || "").length > 2000 && "…"}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
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
                {staged
                  ? `From "${staged.document.title}"${staged.chunkCount > 1 ? ` — processed in ${staged.chunkCount} sections` : ""}`
                  : "Extracted entries appear here before they become canon."}
              </div>
            </div>
            {proposed.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn small variant="primary" disabled={pendingIds.length > 0} onClick={() => approve(visible)} title="Approve and add all entries shown to your World Book">
                  Add all {filter === "all" ? "" : "shown "}({visible.length})
                </Btn>
                <Btn small disabled={pendingIds.length > 0} onClick={() => discardAll(visible)} title="Discard all entries shown, without adding them">
                  Discard all {filter === "all" ? "" : "shown "}({visible.length})
                </Btn>
              </div>
            )}
          </div>

          {busy && pipelineMode === "docling" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Tag>1. IBM Docling parses the file</Tag>
              <Tag>2. IBM Granite extracts entries</Tag>
            </div>
          )}

          {proposed.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {FILTERS.map((f) => (
                <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)} title={`Show only ${f.label}`}>
                  {f.label}
                  {f.id !== "all" && ` (${proposed.filter((p) => p.type === f.id).length})`}
                </Chip>
              ))}
            </div>
          )}

          {busy && <Busy label={busyLabel} />}
          {error && <Banner tone="danger">{error}</Banner>}
          {notice && !error && <Banner tone="ok">{notice}</Banner>}

          {!busy && !staged && (
            <EmptyState
              icon={IconFolder}
              title="Nothing extracted yet"
              text="Paste a document on the left and hit Extract (or drop a file onto the card). You'll get a list of characters, locations, props, and events to review before anything is added."
            />
          )}

          {!busy && staged && proposed.length === 0 && (
            <EmptyState
              icon={addedCount > 0 ? IconCheck : IconSearch}
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
                  editing={editingId === item.id}
                  draft={editingId === item.id ? editDraft : null}
                  onStartEdit={startEdit}
                  onEditField={editField}
                  onSaveEdit={saveEdit}
                  onCancelEdit={cancelEdit}
                />
              ))}
            </div>
          )}
        </div>

        {staged?.matches?.length > 0 && (
          <div className="card">
            <div className="section-label">Already in your World Book ({staged.matches.length})</div>
            <p style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 12, lineHeight: 1.6 }}>
              These names already exist (some may be close/fuzzy matches, not exact). Compare the
              two versions below — click "Update existing entry" to replace it with this document's
              version, "Merge" to combine both, or leave it alone and edit it yourself later from the World Book.
            </p>
            {error && <Banner tone="danger">{error}</Banner>}
            {notice && !error && <Banner tone="ok">{notice}</Banner>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {staged.matches.map((m, i) => (
                <div key={i} style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{m.existing.title}</div>
                    {m.confidence === "likely" && <Tag>likely match — check before merging</Tag>}
                  </div>
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
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <Btn small disabled={pendingMatchIds.includes(m.existing.id)} onClick={() => updateExisting(m)} title="Replace the existing entry with this document's version">
                      Update existing entry
                    </Btn>
                    <Btn small disabled={pendingMatchIds.includes(m.existing.id)} onClick={() => mergeExisting(m)} title="Combine the existing entry with this document's version">
                      Merge
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {staged?.relationships?.length > 0 && (
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div className="section-label" style={{ marginBottom: 0 }}>Relationships ({staged.relationships.length})</div>
              <Btn small variant="primary" disabled={pendingRelIds.length > 0} onClick={() => approveRelationships(staged.relationships)} title="Save all relationships shown">
                Save all relationships
              </Btn>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {staged.relationships.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: 10 }}>
                  <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
                    <strong style={{ color: "var(--text)" }}>{r.a}</strong>
                    {" ↔ "}
                    <strong style={{ color: "var(--text)" }}>{r.b}</strong>
                    {r.context ? ` — ${r.context}` : ""}
                  </div>
                  <Btn small disabled={pendingRelIds.includes(r.id)} onClick={() => approveRelationships([r])} title="Save this relationship">
                    Approve
                  </Btn>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`@media (max-width: 1000px) { #import-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
