import { useState, useEffect } from "react";
import { ROLES, PERSONAS } from "../lib/worldData";
import { pingBackend } from "../lib/api";
import { Chip, Field, Btn, Banner } from "../components/ui";
import { IconCheck, IconClose, IconSun, IconMoon } from "../components/Icons";

export default function Settings({ world, setWorld, mode, toggleTheme, onReset }) {
  const [name, setName] = useState(world.name);
  const [archetype, setArchetype] = useState(world.personaLabel || "");
  const [desc, setDesc] = useState(world.description || "");

  // Picking a World style below also changes personaLabel -- keep this field's
  // local draft in sync so it doesn't show stale text after that action.
  useEffect(() => {
    setArchetype(world.personaLabel || "");
  }, [world.personaLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saved, setSaved] = useState(false);
  const [ping, setPing] = useState(null);
  const [pinging, setPinging] = useState(false);
  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1500); };

  async function testConnection() {
    setPinging(true); setPing(null);
    try {
      const res = await pingBackend();
      if (res.ok) {
        setPing({ ok: true, text: `Connected via ${res.model}, replied "${res.reply}".` });
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

  function resetWorld() {
    if (!confirm("This clears your saved world and restarts onboarding. Continue?")) return;
    onReset();
  }

  return (
    <div className="fade-in content-narrow">
      <h1 style={{ fontSize: 28, marginBottom: 24 }}>Settings</h1>
      {saved && <Banner tone="ok">Saved.</Banner>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 6 }}>Connection</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>
          If nothing is generating, run this first. It shows whether the problem is the service or your world.
        </p>
        <Btn small onClick={testConnection} disabled={pinging} title="Check whether the AI backend is reachable">{pinging ? "Testing…" : "Test connection"}</Btn>
        {ping && (
          <p style={{ fontSize: 13.5, color: ping.ok ? "var(--ok)" : "var(--danger)", marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
            {ping.ok ? <IconCheck width={14} height={14} /> : <IconClose width={14} height={14} />} {ping.text}
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 10 }}>Appearance</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <Chip active={mode === "light"} onClick={() => mode !== "light" && toggleTheme()} title="Switch to light theme"><IconSun width={13} height={13} /> Light</Chip>
          <Chip active={mode === "dark"} onClick={() => mode !== "dark" && toggleTheme()} title="Switch to dark theme"><IconMoon width={13} height={13} /> Dark</Chip>
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
        <h3 style={{ fontSize: 15.5, marginBottom: 6 }}>World archetype</h3>
        <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 10 }}>
          The short label under your world's name in the sidebar, and how the AI refers to its own role while
          generating ("You are the resident ___ of the world..."). Picking a World style above sets this for you.
          Edit it here to fine-tune the exact wording without changing your eras or starter ideas.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Field value={archetype} onChange={(e) => setArchetype(e.target.value)} placeholder="e.g. Dark-comedy crime thriller" />
          <Btn small onClick={() => { if (archetype.trim()) { setWorld({ ...world, personaLabel: archetype.trim() }); flash(); } }} disabled={!archetype.trim() || archetype.trim() === (world.personaLabel || "")} title="Save this world's archetype label">Save</Btn>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 6 }}>World premise</h3>
        <p style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 10 }}>
          A short summary of what this world is about. Every generation and character chat reads this, so it's how the AI knows more than just your world's name.
        </p>
        <Field area rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="A few sentences: genre, setting, what's at stake…" style={{ marginBottom: 10 }} />
        <Btn small onClick={() => { setWorld({ ...world, description: desc.trim() }); flash(); }} disabled={desc.trim() === (world.description || "")} title="Save this world's premise">Save</Btn>
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
        <Btn small onClick={resetWorld} title="Clear this world and start onboarding again (cannot be undone)">Reset world</Btn>
      </div>
    </div>
  );
}
