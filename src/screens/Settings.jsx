import { useState } from "react";
import { ROLES, PERSONAS } from "../lib/worldData";
import { pingBackend } from "../lib/api";
import { Chip, Field, Btn, Banner } from "../components/ui";

export default function Settings({ world, setWorld, mode, toggleTheme, onReset }) {
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
        <Btn small onClick={testConnection} disabled={pinging}>{pinging ? "Testing…" : "Test connection"}</Btn>
        {ping && <p style={{ fontSize: 13.5, color: ping.ok ? "var(--ok)" : "var(--danger)", marginTop: 10 }}>{ping.ok ? "✓ " : "✕ "}{ping.text}</p>}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 10 }}>Appearance</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <Chip active={mode === "light"} onClick={() => mode !== "light" && toggleTheme()}>☀ Light</Chip>
          <Chip active={mode === "dark"} onClick={() => mode !== "dark" && toggleTheme()}>🌙 Dark</Chip>
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
          {PERSONAS.map((p) => <Chip key={p.id} active={world.personaId === p.id} onClick={() => changePersona(p)}>{p.label}</Chip>)}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15.5, marginBottom: 10 }}>World name</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <Field value={name} onChange={(e) => setName(e.target.value)} />
          <Btn small onClick={() => { if (name.trim()) { setWorld({ ...world, name: name.trim() }); flash(); } }} disabled={!name.trim() || name.trim() === world.name}>Save</Btn>
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15.5, marginBottom: 6, color: "var(--danger)" }}>Danger zone</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: 12 }}>Clears your world and restarts onboarding.</p>
        <Btn small onClick={resetWorld}>Reset world</Btn>
      </div>
    </div>
  );
}
