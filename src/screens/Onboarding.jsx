import { useState } from "react";
import { ROLES, PERSONAS } from "../lib/worldData";
import { Btn, Chip, Field } from "../components/ui";
import { IconSun, IconMoon, IconCheck, IconArrowRight } from "../components/Icons";
import { generateCustomPersona } from "../lib/api";

const CAPABILITIES = [
  { icon: "📜", title: "Gap-Filling Engine", text: "Turn a one-line idea into full, canon-consistent lore." },
  { icon: "🧑", title: "NPC Cast Generator", text: "Populate your world with characters you can talk to." },
  { icon: "🗣️", title: "Dialect & Voice", text: "Give each faction a distinct, hearable voice." },
  { icon: "🕰️", title: "Time-Shift Mode", text: "See any entry re-rendered in a different era." },
  { icon: "🏷️", title: "Auto-Tagging", text: "Everything is tagged and searchable as your world grows." },
];

export default function Onboarding({ onDone, mode, toggleTheme }) {
  const [step, setStep] = useState(0);
  const [roles, setRoles] = useState([]);
  const [persona, setPersona] = useState(null);
  const [name, setName] = useState("");

  // custom-world state
  const [showCustom, setShowCustom] = useState(false);
  const [customDesc, setCustomDesc] = useState("");
  const [customGenerating, setCustomGenerating] = useState(false);
  const [customOffline, setCustomOffline] = useState(false);

  const toggleRole = (id) => setRoles((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  const handlePickPersona = (p) => {
    setShowCustom(false);
    setPersona(p);
    setStep(2);
  };

  const handleCustomGenerate = async () => {
    if (customGenerating || customDesc.trim().length < 10) return;
    setCustomGenerating(true);
    setCustomOffline(false);
    try {
      const data = await generateCustomPersona(customDesc.trim());
      const built = {
        id: "custom",
        label: data.personaLabel || "Custom world",
        desc: customDesc.trim(),
        eras: Array.isArray(data.eras) && data.eras.length === 3
          ? data.eras
          : ["Act One", "Act Two", "Act Three"],
        nameIdeas: Array.isArray(data.nameIdeas) ? data.nameIdeas : [],
        dialects: {},
        ideas: [],
        seed: Array.isArray(data.seed) ? data.seed : [],
      };
      setPersona(built);
      setStep(2);
    } catch (_err) {
      // Offline fallback — let user continue with generic structure
      setCustomOffline(true);
      const built = {
        id: "custom",
        label: "Custom world",
        desc: customDesc.trim(),
        eras: ["Act One", "Act Two", "Act Three"],
        nameIdeas: [],
        dialects: {},
        ideas: [],
        seed: [],
      };
      setPersona(built);
      setStep(2);
    } finally {
      setCustomGenerating(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1.1fr 1fr" }} className="onboarding-grid">
      <div style={{
        background: "linear-gradient(160deg, var(--bg-elevated), var(--bg))",
        padding: "56px 64px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        borderRight: "1px solid var(--border-soft)",
      }} className="onboarding-pitch">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <div className="brand-mark" style={{ width: 44, height: 44, fontSize: 22 }}>W</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--text-dim)", letterSpacing: "0.02em" }}>Worldbuilding Co-Pilot</div>
        </div>
        <h1 style={{ fontSize: 40, lineHeight: 1.15, marginBottom: 16, maxWidth: 480 }}>
          Turn fragments into a living, connected story world.
        </h1>
        <p style={{ fontSize: 16, color: "var(--text-dim)", lineHeight: 1.7, maxWidth: 460, marginBottom: 40 }}>
          Feed it a sketch, a name, a rough idea. It grows into grounded lore,
          characters you can talk to, and a world you can walk through different eras —
          always consistent with what you've already built.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {CAPABILITIES.map((c) => (
            <div key={c.title} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ fontSize: 20, width: 32 }}>{c.icon}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{c.title}</div>
                <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>{c.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "56px 64px", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative" }}>
        <button className="icon-btn" onClick={toggleTheme} style={{ position: "absolute", top: 32, right: 32 }} aria-label="Toggle theme">
          {mode === "dark" ? <IconSun /> : <IconMoon />}
        </button>

        <div style={{ maxWidth: 440, width: "100%", margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: i <= step ? "var(--accent)" : "var(--border)" }} />
            ))}
          </div>

          {step === 0 && (
            <div className="fade-in">
              <div className="section-label">Step 1 of 3</div>
              <h2 style={{ fontSize: 24, marginBottom: 6 }}>What describes you?</h2>
              <p style={{ color: "var(--text-dim)", fontSize: 14.5, marginBottom: 20 }}>Pick all that apply — wearing several hats is normal, the app blends them.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => toggleRole(r.id)}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      textAlign: "left", padding: "16px 18px", borderRadius: "var(--radius)",
                      border: `2px solid ${roles.includes(r.id) ? "var(--accent)" : "var(--border)"}`,
                      background: roles.includes(r.id) ? "var(--accent-soft)" : "var(--surface)",
                      cursor: "pointer", color: "var(--text)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15.5 }}>{r.label}</div>
                      <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{r.blurb}</div>
                    </div>
                    <div style={{
                      width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                      border: `2px solid ${roles.includes(r.id) ? "var(--accent)" : "var(--border)"}`,
                      background: roles.includes(r.id) ? "var(--accent)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center", color: "var(--on-accent)",
                    }}>{roles.includes(r.id) && <IconCheck width={14} height={14} />}</div>
                  </button>
                ))}
              </div>
              <Btn variant="primary" disabled={!roles.length} onClick={() => setStep(1)}>
                Continue {roles.length ? `with ${roles.length} role${roles.length > 1 ? "s" : ""}` : ""} <IconArrowRight width={16} height={16} />
              </Btn>
            </div>
          )}

          {step === 1 && (
            <div className="fade-in">
              <div className="section-label">Step 2 of 3</div>
              <h2 style={{ fontSize: 24, marginBottom: 6 }}>What kind of world?</h2>
              <p style={{ color: "var(--text-dim)", fontSize: 14.5, marginBottom: 20 }}>This sets your starting canon, eras, and voice. You can change it later.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {PERSONAS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handlePickPersona(p)}
                    style={{ display: "block", textAlign: "left", padding: "16px 18px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", color: "var(--text)" }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 15.5 }}>{p.label}</div>
                    <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>{p.desc}</div>
                  </button>
                ))}

                {/* 5th option: describe your own world */}
                <button
                  onClick={() => setShowCustom((v) => !v)}
                  style={{
                    display: "block", textAlign: "left", padding: "16px 18px",
                    borderRadius: "var(--radius)",
                    border: `1px solid ${showCustom ? "var(--accent)" : "var(--border)"}`,
                    background: showCustom ? "var(--accent-soft)" : "var(--surface)",
                    cursor: "pointer", color: "var(--text)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 15.5 }}>Describe your own world</div>
                  <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>A few sentences — we'll build the structure around your idea</div>
                </button>

                {showCustom && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
                    <textarea
                      value={customDesc}
                      onChange={(e) => setCustomDesc(e.target.value)}
                      placeholder="A few sentences about the world you want — genre, era, what's at stake…"
                      rows={4}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        padding: "12px 14px", borderRadius: "var(--radius)",
                        border: "1px solid var(--border)", background: "var(--surface)",
                        color: "var(--text)", fontSize: 14, lineHeight: 1.6,
                        resize: "vertical", fontFamily: "inherit",
                      }}
                    />
                    <Btn
                      variant="primary"
                      disabled={customDesc.trim().length < 10 || customGenerating}
                      onClick={handleCustomGenerate}
                    >
                      {customGenerating ? "Generating…" : "Generate"} <IconArrowRight width={16} height={16} />
                    </Btn>
                  </div>
                )}
              </div>
              <Btn onClick={() => setStep(0)}>Back</Btn>
            </div>
          )}

          {step === 2 && persona && (
            <div className="fade-in">
              <div className="section-label">Step 3 of 3</div>
              <h2 style={{ fontSize: 24, marginBottom: 6 }}>Name your world</h2>
              <p style={{ color: "var(--text-dim)", fontSize: 14.5, marginBottom: 16 }}>Pick an idea, or write your own.</p>
              {customOffline && (
                <div style={{
                  fontSize: 13, color: "var(--text-dim)", background: "var(--surface)",
                  border: "1px solid var(--border)", borderRadius: "var(--radius)",
                  padding: "10px 14px", marginBottom: 16,
                }}>
                  Generated offline — eras and seed entries will be placeholders. You can refine them later.
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {persona.nameIdeas.map((n) => <Chip key={n} active={name === n} onClick={() => setName(n)}>{n}</Chip>)}
              </div>
              <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Or type your own name…" style={{ marginBottom: 20 }} />
              <div style={{ display: "flex", gap: 10 }}>
                <Btn onClick={() => { setStep(1); setCustomOffline(false); }}>Back</Btn>
                <Btn variant="primary" disabled={!name.trim()} onClick={() => onDone({
                  name: name.trim(), roles, personaId: persona.id, personaLabel: persona.label,
                  eras: persona.eras, ideas: persona.ideas, dialects: persona.dialects || {},
                  seed: persona.seed.map((s, i) => ({ ...s, id: i + 1, createdAt: Date.now() - (persona.seed.length - i) * 1000 })),
                })}>Create my world <IconArrowRight width={16} height={16} /></Btn>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 16, lineHeight: 1.6 }}>
                Your world starts with a few example entries so there's something to explore right away.
              </p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .onboarding-grid { grid-template-columns: 1fr !important; }
          .onboarding-pitch { display: none !important; }
        }
      `}</style>
    </div>
  );
}
