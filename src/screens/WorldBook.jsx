import { useState } from "react";
import { TYPES, TYPE_META } from "../lib/worldData";
import { auditWorld, deleteAsset, updateAsset, ask } from "../lib/api";
import { offlineAudit, offlineAnswer } from "../lib/generation";
import { Chip, Field, Btn, Busy, EmptyState, Banner } from "../components/ui";
import { IconSearch, IconCheck, IconAlert, IconTrash, IconEdit, IconGlobe, IconBook, TypeIcon } from "../components/Icons";
import AssetCard from "../components/AssetCard";

const SUGGESTED = [
  "What is the most dangerous place here?",
  "Who has the most to lose?",
  "What does everyone get wrong about this world?",
  "What happened in the earliest era?",
];

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

  // "Ask about the world" -- moved here from the Characters screen (it
  // answers only from established canon, so it belongs next to the canon
  // itself, not in the character-chat screen).
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

  const filtered = assets.filter((a) => {
    const okQ = !q || (a.title + a.content + a.era + a.faction + a.type).toLowerCase().includes(q.toLowerCase());
    return okQ && (typeFilter === "all" || a.type === typeFilter);
  });

  async function checkConsistency() {
    setBusy(true); setError(""); setReport(null);
    try {
      const result = await auditWorld(world.id);
      setReport({ issues: Array.isArray(result.issues) ? result.issues : [] });
      if (result.offline) {
        setError(`Service unavailable (${result.error}). Ran a basic local check instead.`);
      } else if (result.skipped) {
        setError(`This world has more entries than one check can cover at once — only the ${assets.length - result.skipped} most recent were checked (${result.skipped} older ${result.skipped === 1 ? "entry wasn't" : "entries weren't"}).`);
      }
    } catch (e) {
      setReport(offlineAudit(assets));
      setError(`Service unavailable (${e.message}). Ran a basic local check instead.`);
    }
    setBusy(false);
  }

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, marginBottom: 6 }}>World Book</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14.5 }}>Everything true about {world.name}. Search it, filter it, ask it questions, or run a consistency check.</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><IconGlobe width={13} height={13} /> Ask about the world</div>
        <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 10 }}>
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

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 280px" }}>
          <IconSearch style={{ position: "absolute", left: 13, top: 13, color: "var(--text-faint)" }} />
          <Field value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your world…" title="Search title, content, era, affiliation, or type" style={{ paddingLeft: 40 }} />
        </div>
        <Btn onClick={checkConsistency} disabled={busy || assets.length < 2} title="Consistency check — scans your whole World Book for contradictions, duplicate names, and orphaned references, and double-checks each finding before showing it to you">Consistency check</Btn>
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
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}><IconCheck /> Everything agrees — no contradictions found.</span>
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

      {filtered.length === 0 ? (
        <EmptyState
          icon={IconBook}
          title={assets.length === 0 ? "Your World Book is empty" : "Nothing matches"}
          text={assets.length === 0 ? "Add your first entry and it will show up here, fully tagged and searchable." : "Try a different search term or filter."}
          action={assets.length === 0 && <Btn variant="primary" onClick={() => setTab("create")}>Add your first idea</Btn>}
        />
      ) : (
        <div className="grid-cards">
          {filtered.map((a) => (
            <div key={a.id} style={{ position: "relative" }}>
              {editingId === a.id ? (
                <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15, marginBottom: 2 }}>
                    Editing — {a.type === "other" ? (a.typeLabel || "Other") : TYPE_META[a.type]?.label || a.type}
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
                      rows={5}
                      value={editForm.content}
                      onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                      placeholder="Description"
                    />
                  </label>
                  {a.type === "other" && (
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className="section-label">Category name</span>
                      <Field
                        value={editForm.typeLabel}
                        onChange={(e) => setEditForm((f) => ({ ...f, typeLabel: e.target.value }))}
                        placeholder='What kind of thing is this? (e.g. "Faction", "Clan")'
                        title="This world tracks entries that don't fit Lore/Character/Location/Event under 'Other' — name what this one actually is."
                      />
                    </label>
                  )}
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="section-label">Affiliation (or —)</span>
                    <Field
                      value={editForm.faction}
                      onChange={(e) => setEditForm((f) => ({ ...f, faction: e.target.value }))}
                      placeholder="Group, org, or affiliation (or —)"
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="section-label">Mood</span>
                    <Field
                      value={editForm.mood}
                      onChange={(e) => setEditForm((f) => ({ ...f, mood: e.target.value }))}
                      placeholder="Mood"
                    />
                  </label>
                  {editError && <Banner tone="danger" onClose={() => setEditError("")}>{editError}</Banner>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn
                      small
                      variant="primary"
                      disabled={editSaving || !editForm.title?.trim() || !editForm.content?.trim()}
                      onClick={() => saveEdit(a)}
                      title="Save changes to this entry"
                    >
                      Save
                    </Btn>
                    <Btn small disabled={editSaving} onClick={cancelEdit} title="Discard changes">Cancel</Btn>
                  </div>
                </div>
              ) : (
                <>
                  <AssetCard asset={a} />
                  <button
                    className="icon-btn"
                    title={`Edit "${a.title}"`}
                    style={{ position: "absolute", top: 8, right: 34, opacity: 0.6 }}
                    onClick={() => startEdit(a)}
                  >
                    <IconEdit width={15} height={15} />
                  </button>
                  <button
                    className="icon-btn"
                    title={`Delete "${a.title}"`}
                    style={{ position: "absolute", top: 8, right: 8, opacity: 0.6 }}
                    onClick={async () => {
                      if (!window.confirm(`Delete "${a.title}"? This can't be undone.`)) return;
                      await deleteAsset(world.id, a.id);
                      removeAsset(a.id);
                    }}
                  >
                    <IconTrash width={15} height={15} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
