import { useState, useMemo } from "react";
import { TYPES, TYPE_META } from "../lib/worldData";
import { auditWorld, deleteAsset, updateAsset, ask } from "../lib/api";
import { offlineAudit, offlineAnswer } from "../lib/generation";
import { Chip, Field, Btn, Busy, EmptyState, Banner, Tag } from "../components/ui";
import {
  IconSearch, IconCheck, IconAlert, IconTrash, IconEdit, IconGlobe, IconBook, TypeIcon,
  IconChevronDown, IconExpand, IconCollapse,
} from "../components/Icons";

const SUGGESTED = [
  "What is the most dangerous place here?",
  "Who has the most to lose?",
  "What does everyone get wrong about this world?",
  "What happened in the earliest era?",
];

// Read-only presentation of one entry — shared between the detail panel
// (docked, compact) and the expanded overlay (bigger type, full width) so
// the two never drift out of sync. `actions` renders whatever controls
// belong in that context (edit/delete/expand vs. just a close button).
function DetailBody({ asset, big, actions }) {
  const typeLabel = asset.type === "other" && asset.typeLabel ? asset.typeLabel : (TYPE_META[asset.type]?.label || asset.type);
  return (
    <>
      <div className="wb-detail-head">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11, minWidth: 0 }}>
          <TypeIcon type={asset.type} width={big ? 22 : 18} height={big ? 22 : 18} style={{ color: "var(--text-dim)", flexShrink: 0, marginTop: 3 }} />
          <div style={{ minWidth: 0 }}>
            <div className="wb-detail-title">{asset.title}</div>
            <div className="wb-detail-type">{typeLabel}</div>
          </div>
        </div>
        {actions && <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>{actions}</div>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "14px 0" }}>
        <Tag>{asset.era}</Tag>
        {asset.faction !== "—" && <Tag>{asset.faction}</Tag>}
        <Tag>{asset.mood}</Tag>
        {asset.offline && <span className="badge-offline">offline draft</span>}
      </div>
      <p className="wb-detail-content">{asset.content}</p>
    </>
  );
}

export default function WorldBook({ world, assets, setTab, removeAsset, addAsset }) {
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Master-detail selection + collapsible per-type groups in the list panel,
  // plus a fullscreen "expand" overlay for a focused read of one entry.
  const [selectedId, setSelectedId] = useState(null);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});

  // "Ask about the world" -- collapsed by default. It's a full feature, not
  // a toy, but keeping it open by default is exactly what makes this screen
  // feel like a wall of text before you've looked at a single entry.
  const [askOpen, setAskOpen] = useState(false);
  const [askThread, setAskThread] = useState([]);
  const [askDraft, setAskDraft] = useState("");
  const [askBusy, setAskBusy] = useState(false);

  async function sendAsk(textOverride) {
    const question = (textOverride ?? askDraft).trim();
    if (!question) return;
    const next = [...askThread, { role: "user", text: question }];
    setAskThread(next);
    setAskDraft(""); setAskBusy(true);
    try {
      const res = await ask(world.id, "lore", question, next.slice(0, -1));
      setAskThread((t) => [...t, { role: "ai", text: res.reply }]);
    } catch (e) {
      setAskThread((t) => [...t, { role: "ai", text: offlineAnswer(question, assets) }]);
    }
    setAskBusy(false);
  }

  function startEdit(a) {
    setEditingId(a.id);
    setEditForm({ title: a.title, content: a.content, era: a.era, faction: a.faction, mood: a.mood, typeLabel: a.typeLabel || "" });
    setEditError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
    setEditError("");
  }

  async function saveEdit(a) {
    setEditSaving(true);
    setEditError("");
    try {
      const res = await updateAsset(world.id, a.id, {
        title: editForm.title,
        content: editForm.content,
        era: editForm.era,
        faction: editForm.faction,
        mood: editForm.mood,
        typeLabel: editForm.typeLabel,
      });
      addAsset(res);
      setEditingId(null);
      setEditForm({});
    } catch (e) {
      setEditError(`Couldn't save: ${e.message}`);
    }
    setEditSaving(false);
  }

  async function handleDelete(a) {
    if (!window.confirm(`Delete "${a.title}"? This can't be undone.`)) return;
    await deleteAsset(world.id, a.id);
    removeAsset(a.id);
  }

  function selectRow(a) {
    if (editingId) cancelEdit();
    setDetailExpanded(false);
    setSelectedId(a.id);
  }

  function toggleGroup(type) {
    setCollapsedGroups((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  const filtered = useMemo(() => assets.filter((a) => {
    const okQ = !q || (a.title + a.content + a.era + a.faction + a.type).toLowerCase().includes(q.toLowerCase());
    return okQ && (typeFilter === "all" || a.type === typeFilter);
  }), [assets, q, typeFilter]);

  // Grouped by type for the "All" view so a world with 40 entries reads as
  // five short labeled lists instead of one long undifferentiated one; a
  // specific type filter just shows a single flat group.
  const groups = useMemo(() => {
    if (typeFilter !== "all") {
      return [{ type: typeFilter, label: TYPE_META[typeFilter]?.label || typeFilter, items: filtered }];
    }
    return TYPES
      .map((t) => ({ type: t, label: TYPE_META[t]?.label || t, items: filtered.filter((a) => a.type === t) }))
      .filter((g) => g.items.length > 0);
  }, [filtered, typeFilter]);

  const selected = filtered.find((a) => a.id === selectedId) || filtered[0] || null;
  const isEditingSelected = !!selected && editingId === selected.id;

  async function checkConsistency() {
    setBusy(true); setError(""); setReport(null);
    try {
      const result = await auditWorld(world.id);
      setReport({ issues: Array.isArray(result.issues) ? result.issues : [] });
      if (result.offline) {
        setError(`Service unavailable (${result.error}). Ran a basic local check instead.`);
      } else if (result.skipped) {
        setError(`This world has more entries than one check can cover at once. Only the ${assets.length - result.skipped} most recent were checked (${result.skipped} older ${result.skipped === 1 ? "entry wasn't" : "entries weren't"}).`);
      }
    } catch (e) {
      setReport(offlineAudit(assets));
      setError(`Service unavailable (${e.message}). Ran a basic local check instead.`);
    }
    setBusy(false);
  }

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 28, marginBottom: 6 }}>World Book</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14.5 }}>Everything true about {world.name}. Search it, filter it, ask it questions, or run a consistency check.</p>
      </div>

      <div className="wb-ask">
        <button type="button" className="wb-ask-toggle" onClick={() => setAskOpen((v) => !v)} title="Ask a question — answered only from your World Book">
          <IconGlobe width={15} height={15} />
          Ask about the world
          {askThread.length > 0 && <span className="wb-group-count">{askThread.length}</span>}
          <IconChevronDown width={14} height={14} className={`wb-ask-chevron ${askOpen ? "open" : ""}`} />
        </button>
        {askOpen && (
          <div className="wb-ask-body">
            <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "10px 0 12px" }}>
              Answers come only from what's in your World Book below.
            </p>
            {askThread.length === 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {SUGGESTED.map((s) => <Chip key={s} onClick={() => sendAsk(s)}>{s}</Chip>)}
              </div>
            ) : (
              <div style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12, display: "flex", flexDirection: "column", gap: 12, padding: "2px 2px" }}>
                {askThread.map((m, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 2 }}>{m.role === "user" ? "You" : world.personaLabel}</div>
                    <div style={{
                      fontSize: 14, lineHeight: 1.55, color: "var(--text)",
                      background: m.role === "user" ? "var(--accent-soft)" : "var(--raised)",
                      padding: "9px 12px", borderRadius: 10, maxWidth: "85%",
                    }}>
                      {m.text}
                    </div>
                  </div>
                ))}
                {askBusy && <Busy label="thinking…" />}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <Field
                value={askDraft}
                onChange={(e) => setAskDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !askBusy && sendAsk()}
                placeholder="Ask anything about your world…"
              />
              <Btn variant="primary" onClick={() => sendAsk()} disabled={askBusy || !askDraft.trim()} title="Ask about your world">Ask</Btn>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 280px" }}>
          <IconSearch style={{ position: "absolute", left: 13, top: 13, color: "var(--text-faint)" }} />
          <Field value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your world…" title="Search title, content, era, affiliation, or type" style={{ paddingLeft: 40 }} />
        </div>
        <Btn onClick={checkConsistency} disabled={busy || assets.length < 2} title="Scans your whole World Book for contradictions, duplicate names, and orphaned references, and double-checks each finding before showing it to you">Consistency check</Btn>
      </div>

      <div style={{ marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Chip active={typeFilter === "all"} onClick={() => setTypeFilter("all")} title="Show every entry">All ({assets.length})</Chip>
        {TYPES.map((t) => {
          const count = assets.filter((a) => a.type === t).length;
          return <Chip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)} title={`Show only ${TYPE_META[t].label}`}><TypeIcon type={t} width={13} height={13} /> {TYPE_META[t].label} ({count})</Chip>;
        })}
      </div>

      {busy && <Busy label="Checking your whole world for contradictions, then double-checking each finding…" />}
      {error && <Banner tone="danger" onClose={() => setError("")}>{error}</Banner>}
      {report && (
        <Banner tone={report.issues.length ? "danger" : "ok"} onClose={() => setReport(null)}>
          {report.issues.length === 0 ? (
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><IconCheck /> Everything agrees. No contradictions found.</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {report.issues.map((iss, i) => (
                <div key={i}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: iss.severity === "high" ? "var(--danger)" : "var(--accent-strong)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    <IconAlert width={14} height={14} /> {iss.severity === "high" ? "needs fixing" : "worth a look"}
                  </div>
                  <div style={{ fontSize: 14.5, margin: "3px 0 1px" }}>{iss.issue}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{iss.entries.join(" ↔ ")}</div>
                  {iss.evidence && (
                    <div style={{ fontSize: 12, color: "var(--text-faint)", fontStyle: "italic", marginTop: 2 }}>"{iss.evidence}"</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Banner>
      )}

      {assets.length === 0 ? (
        <EmptyState
          icon={IconBook}
          title="Your World Book is empty"
          text="Add your first entry and it will show up here, fully tagged and searchable."
          action={<Btn variant="primary" onClick={() => setTab("create")}>Add your first idea</Btn>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={IconBook} title="Nothing matches" text="Try a different search term or filter." />
      ) : (
        <div className="wb-md">
          <div className="wb-list-panel">
            {groups.map((g) => (
              <div className="wb-group" key={g.type}>
                <div className="wb-group-header" onClick={() => toggleGroup(g.type)}>
                  <IconChevronDown width={12} height={12} className={`wb-group-chevron ${collapsedGroups[g.type] ? "collapsed" : ""}`} />
                  <TypeIcon type={g.type} width={13} height={13} style={{ color: "var(--text-faint)" }} />
                  <span className="wb-group-header-label">{g.label}</span>
                  <span className="wb-group-count">{g.items.length}</span>
                </div>
                {!collapsedGroups[g.type] && g.items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`wb-row ${selected?.id === a.id ? "active" : ""}`}
                    onClick={() => selectRow(a)}
                    title={a.title}
                  >
                    <TypeIcon type={a.type} width={14} height={14} className="wb-row-icon" />
                    <div className="wb-row-main">
                      <div className="wb-row-title">{a.title}</div>
                      <div className="wb-row-meta">{[a.era, a.faction !== "—" ? a.faction : null].filter(Boolean).join(" · ")}</div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="wb-detail-panel">
            {isEditingSelected ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15, marginBottom: 2 }}>
                  Editing: {selected.type === "other" ? (selected.typeLabel || "Other") : TYPE_META[selected.type]?.label || selected.type}
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="section-label">Title</span>
                  <Field
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Title"
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="section-label">Description</span>
                  <Field
                    area
                    rows={7}
                    value={editForm.content}
                    onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                    placeholder="Description"
                  />
                </label>
                {selected.type === "other" && (
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="section-label">Category name</span>
                    <Field
                      value={editForm.typeLabel}
                      onChange={(e) => setEditForm((f) => ({ ...f, typeLabel: e.target.value }))}
                      placeholder='What kind of thing is this? (e.g. "Faction", "Clan")'
                      title="This world tracks entries that don't fit Lore/Character/Location/Event under 'Other'. Name what this one actually is."
                    />
                  </label>
                )}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px" }}>
                    <span className="section-label">Era</span>
                    <select
                      className="field"
                      value={editForm.era}
                      onChange={(e) => setEditForm((f) => ({ ...f, era: e.target.value }))}
                    >
                      {world.eras.map((era) => (
                        <option key={era} value={era}>{era}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px" }}>
                    <span className="section-label">Affiliation (or —)</span>
                    <Field
                      value={editForm.faction}
                      onChange={(e) => setEditForm((f) => ({ ...f, faction: e.target.value }))}
                      placeholder="Group, org, or affiliation (or —)"
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px" }}>
                    <span className="section-label">Mood</span>
                    <Field
                      value={editForm.mood}
                      onChange={(e) => setEditForm((f) => ({ ...f, mood: e.target.value }))}
                      placeholder="Mood"
                    />
                  </label>
                </div>
                {editError && <Banner tone="danger" onClose={() => setEditError("")}>{editError}</Banner>}
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn
                    small
                    variant="primary"
                    disabled={editSaving || !editForm.title?.trim() || !editForm.content?.trim()}
                    onClick={() => saveEdit(selected)}
                    title="Save changes to this entry"
                  >
                    Save
                  </Btn>
                  <Btn small disabled={editSaving} onClick={cancelEdit} title="Discard changes">Cancel</Btn>
                </div>
              </div>
            ) : selected ? (
              <DetailBody
                asset={selected}
                actions={
                  <>
                    <button type="button" className="icon-btn" title="Expand to full screen" onClick={() => setDetailExpanded(true)}>
                      <IconExpand width={15} height={15} />
                    </button>
                    <button type="button" className="icon-btn" title={`Edit "${selected.title}"`} onClick={() => startEdit(selected)}>
                      <IconEdit width={15} height={15} />
                    </button>
                    <button type="button" className="icon-btn" title={`Delete "${selected.title}"`} onClick={() => handleDelete(selected)}>
                      <IconTrash width={15} height={15} />
                    </button>
                  </>
                }
              />
            ) : (
              <EmptyState icon={IconBook} title="Select an entry" text="Pick something from the list to read it here." />
            )}
          </div>
        </div>
      )}

      {detailExpanded && selected && !isEditingSelected && (
        <div className="wb-overlay" onClick={() => setDetailExpanded(false)}>
          <div className="wb-overlay-panel" onClick={(e) => e.stopPropagation()}>
            <DetailBody
              asset={selected}
              big
              actions={
                <button type="button" className="icon-btn" title="Collapse" onClick={() => setDetailExpanded(false)}>
                  <IconCollapse width={15} height={15} />
                </button>
              }
            />
          </div>
        </div>
      )}

      <style>{`
        .wb-ask { border: 1px solid var(--border-soft); border-radius: var(--radius); margin-bottom: 20px; overflow: hidden; background: var(--surface); }
        .wb-ask-toggle {
          width: 100%; display: flex; align-items: center; gap: 8px;
          background: transparent; border: none; cursor: pointer;
          padding: 14px 16px; color: var(--text); font-size: 14px; font-weight: 600; font-family: var(--font-body);
        }
        .wb-ask-toggle:hover { background: var(--surface-hover); }
        .wb-ask-chevron { margin-left: auto; transition: transform .15s ease; color: var(--text-faint); flex-shrink: 0; }
        .wb-ask-chevron.open { transform: rotate(180deg); }
        .wb-ask-body { padding: 0 16px 16px; border-top: 1px solid var(--border-soft); animation: fadeIn .18s ease; }

        .wb-md { display: grid; grid-template-columns: minmax(240px, 320px) 1fr; gap: 18px; align-items: start; }

        .wb-list-panel {
          display: flex; flex-direction: column; gap: 2px;
          max-height: calc(100vh - 280px); min-height: 320px; overflow-y: auto; padding-right: 4px;
          position: sticky; top: calc(var(--topbar-h) + 16px);
        }
        .wb-group + .wb-group { margin-top: 14px; }
        .wb-group-header {
          display: flex; align-items: center; gap: 7px; padding: 6px 8px;
          cursor: pointer; user-select: none; border-radius: var(--radius-sm);
        }
        .wb-group-header:hover { background: var(--surface-hover); }
        .wb-group-header-label { font-size: 11.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--text-faint); font-weight: 700; }
        .wb-group-count { margin-left: auto; font-size: 11px; color: var(--text-faint); background: var(--raised); padding: 1px 7px; border-radius: 999px; flex-shrink: 0; }
        .wb-group-chevron { color: var(--text-faint); transition: transform .15s ease; flex-shrink: 0; }
        .wb-group-chevron.collapsed { transform: rotate(-90deg); }

        .wb-row {
          display: flex; align-items: flex-start; gap: 9px; width: 100%; text-align: left;
          padding: 9px 10px; border-radius: var(--radius-sm); border: 1px solid transparent;
          background: transparent; color: var(--text); cursor: pointer;
          transition: background .12s ease, border-color .12s ease;
        }
        .wb-row:hover { background: var(--surface-hover); }
        .wb-row.active { background: var(--accent-soft); border-color: var(--accent); }
        .wb-row-icon { color: var(--text-faint); margin-top: 2px; flex-shrink: 0; }
        .wb-row-main { min-width: 0; flex: 1; }
        .wb-row-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wb-row-meta { font-size: 11.5px; color: var(--text-faint); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .wb-detail-panel {
          background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius);
          padding: 26px 28px; min-height: 320px;
        }
        .wb-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .wb-detail-title { font-family: var(--font-display); font-weight: 600; font-size: 21px; line-height: 1.25; }
        .wb-detail-type { font-size: 12px; color: var(--text-faint); margin-top: 2px; }
        .wb-detail-content { font-size: 14.5px; line-height: 1.75; color: var(--text-dim); white-space: pre-wrap; margin: 0; }

        .wb-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(3px);
          display: flex; align-items: center; justify-content: center; z-index: 100; padding: 40px 20px;
          animation: fadeIn .15s ease;
        }
        .wb-overlay-panel {
          position: relative; background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius-lg);
          max-width: 760px; width: 100%; max-height: 86vh; overflow-y: auto; padding: 40px 48px; box-shadow: var(--shadow-lg);
        }
        .wb-overlay-panel .wb-detail-title { font-size: 28px; }
        .wb-overlay-panel .wb-detail-content { font-size: 16px; }

        @media (max-width: 900px) {
          .wb-md { grid-template-columns: 1fr; }
          .wb-list-panel { position: static; max-height: none; }
          .wb-overlay-panel { padding: 28px 24px; }
        }
      `}</style>
    </div>
  );
}
