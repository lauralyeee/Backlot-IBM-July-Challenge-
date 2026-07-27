import { useState } from "react";
import { ROLES, PERSONAS } from "../lib/worldData";
import { pingBackend, renameEra, removeEra, describeEras } from "../lib/api";
import { Chip, Field, Btn, Banner } from "../components/ui";

export default function Settings({ world, setWorld, onWorldUpdated, refreshAssets, mode, toggleTheme, onReset }) {
  const [name, setName] = useState(world.name);
  const [saved, setSaved] = useState(false);
  const [ping, setPing] = useState(null);
  const [pinging, setPinging] = useState(false);
  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1500); };

  async function testConnection() {
    setPinging(true); setPing(null);
    try {
      const res = await pingBackend();
      if (res.ok) {
        setPing({ ok: true, text: `Connected via ${res.model} — replied "${res.reply}".` });
      } else {
        setPing({ ok: false, text: `No model reachable. ${res.error}` });
      }
    } catch (e) {
      setPing({ ok: false, text: `No model reachable. ${e.message}` });
    }
    setPinging(false);
  }

  const toggleRole = (id) => {
    const next = world.roles.includes(id) ? world.roles.filter((x) => x !== id) : [...world.roles, id];
    if (!next.length) return;
    setWorld({ ...world, roles: next }); flash();
  };
  const changePersona = (p) => {
    setWorld({ ...world, personaId: p.id, personaLabel: p.label, eras: p.eras, ideas: p.ideas, dialects: p.dialects || {} }); flash();
  };

  // ── Timeline / eras editor ─────────────────────────────────────────────
  const [eraEditIndex, setEraEditIndex] = useState(null);
  const [eraEditValue, setEraEditValue] = useState("");
  const [eraNoteValue, setEraNoteValue] = useState("");
  const [describeBusy, setDescribeBusy] = useState(false);
  const [newEraName, setNewEraName] = useState("");
  const [eraBusy, setEraBusy] = useState(false);
  const [eraError, setEraError] = useState("");
  const [pendingRemoveEra, setPendingRemoveEra] = useState(null);
  const [mergeTarget, setMergeTarget] = useState("");

  function startRenameEra(i) {
    setEraEditIndex(i);
    setEraEditValue(world.eras[i]);
    setEraNoteValue((world.eraNotes || {})[world.eras[i]] || "");
    setEraError("");
  }

  function cancelRenameEra() {
    setEraEditIndex(null);
    setEraEditValue("");
  }

  async function saveRenameEra() {
    const oldEra = world.eras[eraEditIndex];
    const newEra = eraEditValue.trim();
    const newNote = eraNoteValue.trim();
    const oldNote = ((world.eraNotes || {})[oldEra] || "").trim();
    if (!newEra) { cancelRenameEra(); return; }
    if (newEra !== oldEra && world.eras.some((e, i) => i !== eraEditIndex && e.toLowerCase() === newEra.toLowerCase())) {
      setEraError(`"${newEra}" already exists in this timeline.`);
      return;
    }
    if (newEra === oldEra && newNote === oldNote) { cancelRenameEra(); return; }
    setEraBusy(true); setEraError("");
    try {
      let current = world;
      if (newEra !== oldEra) {
        // Rename goes through the dedicated endpoint so the note key AND
        // every asset tagged with the old era name follow the rename.
        const res = await renameEra(world.id, oldEra, newEra);
        current = res.world;
        onWorldUpdated(res.world);
        if (res.assetsUpdated > 0) await refreshAssets();
      }
      if (newNote !== oldNote) {
        setWorld({ ...current, eraNotes: { ...(current.eraNotes || {}), [newEra]: newNote } });
      }
      setEraEditIndex(null); setEraEditValue(""); setEraNoteValue("");
      flash();
    } catch (e) {
      setEraError(`Couldn't save: ${e.message}`);
    }
    setEraBusy(false);
  }

  // Pure reorder — same era strings, new order, no asset cascade needed —
  // so this just goes through the ordinary setWorld/patchWorld path.
  function moveEra(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= world.eras.length) return;
    const next = [...world.eras];
    [next[i], next[j]] = [next[j], next[i]];
    setWorld({ ...world, eras: next });
    flash();
  }

  // Pure append — no existing asset can already reference a brand-new era
  // name, so no cascade needed here either.
  function addEra() {
    const name = newEraName.trim();
    if (!name) return;
    if (world.eras.some((e) => e.toLowerCase() === name.toLowerCase())) {
      setEraError(`"${name}" already exists in this timeline.`);
      return;
    }
    setEraError("");
    setWorld({ ...world, eras: [...world.eras, name] });
    setNewEraName("");
    flash();
  }

  async function attemptRemoveEra(era) {
    setEraError(""); setEraBusy(true);
    try {
      const res = await removeEra(world.id, era);
      onWorldUpdated(res.world);
      if (res.assetsReassigned > 0) await refreshAssets();
      flash();
    } catch (e) {
      if (e.message.includes("409")) {
        setPendingRemoveEra(era);
        setMergeTarget(world.eras.find((x) => x !== era) || "");
      } else {
        setEraError(`Couldn't remove: ${e.message}`);
      }
    }
    setEraBusy(false);
  }

  async function autoDescribe() {
    setDescribeBusy(true); setEraError("");
    try {
      const res = await describeEras(world.id);
      onWorldUpdated(res.world);
      flash();
    } catch (e) {
      setEraError(`Couldn't write descriptions: ${e.message}`);
    }
    setDescribeBusy(false);
  }

  async function confirmRemoveWithMerge() {
    setEraBusy(true); setEraError("");
    try {
      const res = await removeEra(world.id, pendingRemoveEra, mergeTarget);
      onWorldUpdated(res.world);
      await refreshAssets();
      setPendingRemoveEra(null);
      flash();
    } catch (e) {
      setEraError(`Couldn't remove: ${e.message}`);
    }
    setEraBusy(false);
  }

  function resetWorld() {
    if (!confirm("This clears your saved world and restarts onboarding. Continue?")) return;
    onReset();
  }

  return (
    <div className="fade-in content-narrow">
      <h1 style={{ fontSize: 26, marginBottom: 24 }}>Settings</h1>
      {saved && <Banner tone="ok">Saved.</Banner>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 6 }}>Connection</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>
          If nothing is generating, run this first — it shows whether the problem is the service or your world.
        </p>
        <Btn small onClick={testConnection} disabled={pinging} title="Check whether the AI backend is reachable">{pinging ? "Testing…" : "Test connection"}</Btn>
        {ping && <p style={{ fontSize: 13.5, color: ping.ok ? "var(--ok)" : "var(--danger)", marginTop: 10 }}>{ping.ok ? "✓ " : "✕ "}{ping.text}</p>}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 10 }}>Appearance</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <Chip active={mode === "light"} onClick={() => mode !== "light" && toggleTheme()} title="Switch to light theme">☀ Light</Chip>
          <Chip active={mode === "dark"} onClick={() => mode !== "dark" && toggleTheme()} title="Switch to dark theme">🌙 Dark</Chip>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 4 }}>Your roles</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>New content blends what each role needs. At least one stays selected.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ROLES.map((r) => (
            <button
              key={r.id}
              onClick={() => toggleRole(r.id)}
              title={r.blurb}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", padding: "12px 14px",
                borderRadius: "var(--radius-sm)", border: `1.5px solid ${world.roles.includes(r.id) ? "var(--accent)" : "var(--border)"}`,
                background: world.roles.includes(r.id) ? "var(--accent-soft)" : "var(--bg-elevated)", cursor: "pointer", color: "var(--text)",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{r.label}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{r.blurb}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 4 }}>World style</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>Changes the voice, eras, and starter ideas for new content. Existing entries stay as they are.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PERSONAS.map((p) => <Chip key={p.id} active={world.personaId === p.id} onClick={() => changePersona(p)} title={p.desc}>{p.label}</Chip>)}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 4 }}>Timeline / eras</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>
          Not fixed to 3 — add, edit, reorder, or remove eras. Order is the world's chronology.
          The descriptions matter: Time-Shift and portrait generation read them to understand
          what each era actually means, instead of guessing from its name.
        </p>
        {eraError && <p style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10 }}>{eraError}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {world.eras.map((era, i) => (
            <div key={era} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              {eraEditIndex === i ? (
                <>
                  <Field value={eraEditValue} onChange={(e) => setEraEditValue(e.target.value)} />
                  <Field
                    area
                    rows={2}
                    value={eraNoteValue}
                    onChange={(e) => setEraNoteValue(e.target.value)}
                    placeholder="What defines this era? 1-2 sentences — events, tone, tech/culture. Time-Shift and portraits read this."
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn small onClick={saveRenameEra} disabled={eraBusy} title="Save this era's name and description">Save</Btn>
                    <Btn small onClick={cancelRenameEra} title="Discard changes">Cancel</Btn>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ flex: 1, fontSize: 14 }}>{era}</span>
                    <Btn small onClick={() => moveEra(i, -1)} disabled={eraBusy || i === 0} title="Move earlier in the timeline">↑</Btn>
                    <Btn small onClick={() => moveEra(i, 1)} disabled={eraBusy || i === world.eras.length - 1} title="Move later in the timeline">↓</Btn>
                    <Btn small onClick={() => startRenameEra(i)} disabled={eraBusy} title="Rename or add a description for this era">Edit</Btn>
                    <Btn small onClick={() => attemptRemoveEra(era)} disabled={eraBusy || world.eras.length <= 1} title="Remove this era from the timeline">Remove</Btn>
                  </div>
                  {((world.eraNotes || {})[era] || "").trim() ? (
                    <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5 }}>{world.eraNotes[era]}</div>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No description yet — Edit to write one, or use ✨ Auto-describe below.</div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {pendingRemoveEra && (
          <Banner tone="danger">
            <div>
              <div style={{ marginBottom: 8 }}>Entries still use "{pendingRemoveEra}". Move them to another era first:</div>
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={{ marginBottom: 8, width: "100%", padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                {world.eras.filter((e) => e !== pendingRemoveEra).map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn small onClick={confirmRemoveWithMerge} disabled={eraBusy} title="Move affected entries to the selected era, then remove this one">Move &amp; remove</Btn>
                <Btn small onClick={() => setPendingRemoveEra(null)} title="Cancel removing this era">Cancel</Btn>
              </div>
            </div>
          </Banner>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <Field value={newEraName} onChange={(e) => setNewEraName(e.target.value)} placeholder="Add a new era…" />
          <Btn small onClick={addEra} disabled={!newEraName.trim()} title="Add this as a new era">Add</Btn>
        </div>
        <Btn small onClick={autoDescribe} disabled={describeBusy || eraBusy} title="Automatically write short descriptions for eras that don't have one yet">
          {describeBusy ? "Writing descriptions…" : "✨ Auto-describe eras (fills empty ones)"}
        </Btn>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 10 }}>World name</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <Field value={name} onChange={(e) => setName(e.target.value)} />
          <Btn small onClick={() => { if (name.trim()) { setWorld({ ...world, name: name.trim() }); flash(); } }} disabled={!name.trim() || name.trim() === world.name} title="Save the new world name">Save</Btn>
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15.5, marginBottom: 6, color: "var(--danger)" }}>Danger zone</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>Clears your world and restarts onboarding.</p>
        <Btn small onClick={resetWorld} title="Clear this world and start onboarding again — cannot be undone">Reset world</Btn>
      </div>
    </div>
  );
}
