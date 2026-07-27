import { useState } from "react";
import { TYPES, TYPE_META } from "../lib/worldData";
import { auditWorld, deleteAsset, updateAsset } from "../lib/api";
import { offlineAudit } from "../lib/generation";
import { Chip, Field, Btn, Busy, EmptyState, Banner } from "../components/ui";
import { IconSearch, IconCheck, IconAlert, IconTrash, IconEdit } from "../components/Icons";
import AssetCard from "../components/AssetCard";

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

  function startEdit(a) {
    setEditingId(a.id);
    setEditForm({ title: a.title, content: a.content, era: a.era, faction: a.faction, mood: a.mood });
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
      if (result.offline) setError(`Service unavailable (${result.error}). Ran a basic local check instead.`);
    } catch (e) {
      setReport(offlineAudit(assets));
      setError(`Service unavailable (${e.message}). Ran a basic local check instead.`);
    }
    setBusy(false);
  }

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, marginBottom: 6 }}>World Book</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14.5 }}>Everything true about {world.name}. Search it, filter it, or run a consistency check.</p>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 280px" }}>
          <IconSearch style={{ position: "absolute", left: 13, top: 13, color: "var(--text-faint)" }} />
          <Field value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your world…" style={{ paddingLeft: 40 }} />
        </div>
        <Btn onClick={checkConsistency} disabled={busy || assets.length < 2}>Check my world</Btn>
      </div>

      <div style={{ marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Chip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>All ({assets.length})</Chip>
        {TYPES.map((t) => {
          const count = assets.filter((a) => a.type === t).length;
          return <Chip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{TYPE_META[t].icon} {TYPE_META[t].label} ({count})</Chip>;
        })}
      </div>

      {busy && <Busy label="Reading your whole world…" />}
      {error && <Banner tone="danger">{error}</Banner>}
      {report && (
        <Banner tone={report.issues.length ? "danger" : "ok"}>
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
                </div>
              ))}
            </div>
          )}
        </Banner>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="📖"
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
                    Editing — {a.type}
                  </div>
                  <Field
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Title"
                  />
                  <Field
                    area
                    rows={5}
                    value={editForm.content}
                    onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                    placeholder="Description"
                  />
                  <select
                    className="field"
                    value={editForm.era}
                    onChange={(e) => setEditForm((f) => ({ ...f, era: e.target.value }))}
                  >
                    {world.eras.map((era) => (
                      <option key={era} value={era}>{era}</option>
                    ))}
                  </select>
                  <Field
                    value={editForm.faction}
                    onChange={(e) => setEditForm((f) => ({ ...f, faction: e.target.value }))}
                    placeholder="Faction (or —)"
                  />
                  <Field
                    value={editForm.mood}
                    onChange={(e) => setEditForm((f) => ({ ...f, mood: e.target.value }))}
                    placeholder="Mood"
                  />
                  {editError && <Banner tone="danger">{editError}</Banner>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn
                      small
                      variant="primary"
                      disabled={editSaving || !editForm.title?.trim() || !editForm.content?.trim()}
                      onClick={() => saveEdit(a)}
                    >
                      Save
                    </Btn>
                    <Btn small disabled={editSaving} onClick={cancelEdit}>Cancel</Btn>
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
