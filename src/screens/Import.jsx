import { useState, useMemo, useRef, useEffect } from "react";
import {
  ingestText, ingestFile, commitIngested, updateIngestedAsset,
  listDocuments, getCapabilities,
} from "../lib/api";
import { TYPES, TYPE_META } from "../lib/worldData";
import { Field, Btn, Chip, Busy, Banner, Tag, EmptyState } from "../components/ui";
import {
  IconSpark, IconImport, IconFolder, IconCheck, IconSearch, TypeIcon,
  IconEdit, IconClock, IconChevronDown,
} from "../components/Icons";

const SAMPLE_SCRIPT = `

INT. THE LITTLE HOUSE - NIGHT

Flakes of snow drift in through cracks in the roof, falling down on Charlie,
who is doing his homework at the kitchen table. Ever-practical, he opens an
umbrella for protection and keeps right on working.

Meanwhile, his MOTHER chops cabbage for the soup pot. Mother Bucket is an
ever-exhausted woman in her late 30's, run ragged from taking care of
Charlie and the four invalid grandparents. Many nights, she's too tired to
worry, and too worried to sleep.

There are only two rooms in this place altogether. This main room is the
kitchen, the family room, the foyer, the closet and the bedroom for Charlie
and his parents.

The front door swings open, revealing Charlie's FATHER, a lanky,
hard-working man in his late 30's who manages to be grateful for his
blessings, however slight they are.

FATHER
    Evening, Buckets!

CHARLIE
    Hi, Dad!

MOTHER
    The soup's almost ready. I don't suppose there's anything extra to
    put...

Off her husband's look, there's clearly no more food coming. Ever chipper...

MOTHER (CONT'D)
    Well. Nothing goes better with cabbage than cabbage.

She begins to chop up another head.

FATHER
    Charlie, I found something I think you'll like!

He empties out his coat pockets on the table, revealing a handful of small
white plastic caps. With a gasp, Charlie's eyes go wide as he picks one out
of the pile.

CUT TO:

INT. TOOTHPASTE FACTORY - DAY [PAST]

Plump tubes of uncapped toothpaste slide along a conveyor belt.

NARRATOR (V.O.)
    Charlie's father worked in the local toothpaste factory.

As each tube moves past, Father frantically screws on a cap. It's a
needlessly rushed and tedious job.

NARRATOR (V.O.) (CONT'D)
    The hours were long, and the pay was terrible. Yet occasionally, there
    were unexpected surprises.

One of Father's plastic caps won't screw on right. He holds it up for a
closer look, and finds that it's misshapen. In fact, it looks something
like a human head.

FATHER
    Huh.

MATCH CUT TO:

INT. THE LITTLE HOUSE - NIGHT

Charlie holds the same little plastic cap.

CHARLIE
    It's exactly what I need!

Excited, he runs into the other room.

`;

// Derived from worldData's TYPES/TYPE_META (the same source WorldBook.jsx
// filters against) instead of a separate hardcoded list -- keeps Import's
// categories from drifting out of sync with what the World Book actually
// has (this previously had its own "Props & lore" label and no "Other"
// filter at all, even though extracted items can land in either bucket).
const FILTERS = [{ id: "all", label: "All" }, ...TYPES.map((t) => ({ id: t, label: TYPE_META[t].label }))];

// Left accent bar per type -- monochrome, so differentiated by weight
// rather than hue (the type icon on each card carries the rest).
const ACCENT = {
  character: "var(--text)",
  location: "var(--text-dim)",
  lore: "var(--text-faint)",
  event: "var(--text-dim)",
  other: "var(--text-faint)",
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
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pastImports, setPastImports] = useState([]);
  const [pastImportsOpen, setPastImportsOpen] = useState(false);
  const [expandedImportId, setExpandedImportId] = useState(null);
  const fileInputRef = useRef(null);

  // Defaults to fully-enabled so nothing flashes disabled while the fetch
  // is in flight (or greys out permanently if it fails) -- /api/capabilities
  // only ever turns things OFF from this baseline, on Vercel today.
  const [capabilities, setCapabilities] = useState({
    model3dGeneration: true,
    mediaUpload: true,
    doclingImport: true,
  });

  useEffect(() => {
    getCapabilities().then(setCapabilities).catch(() => {});
  }, []);

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
        ? "Long document: extracting in sections, this can take a bit longer…"
        : "Reading the document and pulling out entries…"
    );
    try {
      const res = await ingestText(world.id, { text: t, title: ti });
      setStaged(res);
      setProposed(res.proposed);
      if (res.offline) {
        setError("Service unavailable, so this is a rough offline extraction. Check each entry carefully before adding it.");
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
    if (usesDocling && !capabilities.doclingImport) {
      setError(
        "PDF/DOCX parsing (IBM Docling) isn't available in this hosted demo — "
        + "paste the text instead, or upload a .txt/.fountain file."
      );
      return;
    }
    setBusy(true); setError(""); setNotice(""); setStaged(null); setProposed([]); setAddedCount(0);
    setPipelineMode(usesDocling ? "docling" : "text");
    setBusyLabel(
      usesDocling
        ? "Parsing with Docling: first run can take a bit longer…"
        : "Reading the file and pulling out entries…"
    );
    try {
      const res = await ingestFile(world.id, file, title || file.name);
      setStaged(res);
      setProposed(res.proposed);
      if (res.offline) {
        setError("Service unavailable, so this is a rough offline extraction. Check each entry carefully before adding it.");
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
      setError(`Unsupported file type '${ext || "unknown"}'. Drop a PDF, DOCX, TXT, or Fountain file.`);
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

  function rerunPastImport(doc) {
    setTitle(doc.title);
    setText(doc.rawText);
    setPastImportsOpen(false);
    extract(doc.rawText, doc.title);
  }

  return (
    <div className="fade-in import-screen">
      <div className="import-head">
        <h1 style={{ fontSize: 28, marginBottom: 6 }}>Import</h1>
        <p>
          Start from something you’ve already written. Paste a script, treatment,
          or outline and it’s broken down into entries you can review one by one.
        </p>
      </div>

      <div className="import-toolbar">
        <div className="section-label" style={{ marginBottom: 0 }}>Source document</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Btn small variant="ghost" onClick={() => { setText(SAMPLE_SCRIPT); setTitle("Sample scene"); }} title="Fill the box with an example scene to try extraction">
            Load sample
          </Btn>
          <button type="button" className="import-past-toggle" onClick={() => setPastImportsOpen((v) => !v)} title="Show documents you've previously extracted from">
            <IconClock width={14} height={14} /> Past imports{pastImports.length > 0 ? ` · ${pastImports.length}` : ""}
            <IconChevronDown width={13} height={13} style={{ transform: pastImportsOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
          </button>
        </div>
      </div>

      {pastImportsOpen && (
        <div className="import-past-row">
          {pastImports.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--text-faint)", margin: 0 }}>Nothing extracted yet. Your past imports will show up here.</p>
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

      <div className="import-body">
      {/* ── Left: source document ─────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          className="card"
          onDragOver={onDragOverZone}
          onDragLeave={onDragLeaveZone}
          onDrop={onDropFile}
          style={isDragOver ? { borderColor: "var(--text)", borderStyle: "dashed" } : undefined}
        >
          <Field
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Document name (e.g. Episode 3 draft)"
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
            <Btn
              small
              variant="ghost"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              title={
                capabilities.doclingImport
                  ? "Upload a file to extract entries from (PDF/DOCX parsed by IBM Docling; TXT/Fountain read directly), or drag one onto this card"
                  : "Upload a TXT or Fountain file to extract entries from, or drag one onto this card. PDF/DOCX parsing (IBM Docling) isn't available in this hosted demo."
              }
            >
              <IconImport width={15} height={15} /> {capabilities.doclingImport ? "Upload PDF, DOCX, TXT, or Fountain" : "Upload TXT or Fountain"}
            </Btn>
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
              {capabilities.doclingImport
                ? "PDF/DOCX parsed by IBM Docling; TXT/Fountain read directly. Either way, it's extracted the same way as pasted text."
                : "PDF/DOCX parsing (IBM Docling) isn't available in this hosted demo — paste the text instead, or upload a .txt/.fountain file."}
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={
              capabilities.doclingImport
                ? ".pdf,.docx,.txt,.fountain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                : ".txt,.fountain,text/plain"
            }
            onChange={onFileSelected}
            style={{ display: "none" }}
          />
        </div>

        <p style={{ fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.6, margin: 0 }}>
          Nothing is saved to your World Book until you approve it. Extracting is
          always safe to re-run: it never edits what's already there.
        </p>
      </div>

      {/* ── Right: review queue ───────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div className="import-stat-strip">
          <div className="import-stat"><div className="import-stat-label">Awaiting review</div><div className="import-stat-value">{counts.total}</div></div>
          <div className="import-stat"><div className="import-stat-label">Characters</div><div className="import-stat-value">{counts.character}</div></div>
          <div className="import-stat"><div className="import-stat-label">Locations</div><div className="import-stat-value">{counts.location}</div></div>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 380 }}>
          <div className="import-review-head">
            <div>
              <div className="import-review-label">Review queue</div>
              <div className="import-review-sub">
                {staged
                  ? `From "${staged.document.title}"${staged.chunkCount > 1 ? `, processed in ${staged.chunkCount} sections` : ""}`
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
              two versions below, then click "Update existing entry" to replace it with this document's
              version, "Merge" to combine both, or leave it alone and edit it yourself later from the World Book.
            </p>
            {error && <Banner tone="danger">{error}</Banner>}
            {notice && !error && <Banner tone="ok">{notice}</Banner>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {staged.matches.map((m, i) => (
                <div key={i} style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{m.existing.title}</div>
                    {m.confidence === "likely" && <Tag>likely match, check before merging</Tag>}
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
      </div>
      </div>

      <style>{`
        .import-screen { display: flex; flex-direction: column; }
        .import-head p { color: var(--text-dim); font-size: 14.5px; line-height: 1.6; max-width: 640px; margin-top: 6px; }

        .import-toolbar {
          display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
          gap: 14px; margin-top: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border-soft);
        }
        .import-past-toggle {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--font-body); font-size: 13px; font-weight: 500;
          color: var(--text-dim); background: transparent; border: none; cursor: pointer; padding: 8px 2px;
        }
        .import-past-toggle:hover { color: var(--text); }
        .import-past-row {
          display: flex; flex-direction: column; gap: 10px;
          padding: 16px 2px 2px; animation: fadeIn 0.18s ease;
        }

        .import-body {
          display: grid; grid-template-columns: minmax(0, 420px) minmax(0, 1fr); gap: 28px;
          margin-top: 20px;
        }

        .import-stat-strip {
          display: flex; border: 1px solid var(--border-soft); border-radius: var(--radius); background: var(--surface); overflow: hidden;
        }
        .import-stat { flex: 1; text-align: center; padding: 14px 10px; }
        .import-stat + .import-stat { border-left: 1px solid var(--border-soft); }
        .import-stat-label { font-size: 11.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
        .import-stat-value { font-family: var(--font-display); font-size: 26px; font-weight: 700; margin-top: 4px; }

        .import-review-head {
          display: flex; align-items: flex-start; justify-content: space-between;
          flex-wrap: wrap; gap: 12px; border-bottom: 1px solid var(--border-soft); padding-bottom: 14px;
        }
        .import-review-label { font-family: var(--font-display); font-size: 19px; font-weight: 600; }
        .import-review-sub { font-size: 12.5px; color: var(--text-faint); margin-top: 3px; }

        @media (max-width: 1000px) { .import-body { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
