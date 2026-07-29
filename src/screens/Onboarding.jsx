import { useState } from "react";
import { ROLES, PERSONAS } from "../lib/worldData";
import { Btn, Chip, Field } from "../components/ui";
import { IconSun, IconMoon, IconCheck, IconArrowRight, IconDocument, IconPerson, IconMic, IconClock, IconTag } from "../components/Icons";
import { generateCustomPersona } from "../lib/api";

const CAPABILITIES = [
  { icon: IconDocument, title: "Gap-Filling", text: "One line in, a page of lore out." },
  { icon: IconPerson, title: "Characters", text: "Arrive backstoried. You can talk to them." },
  { icon: IconMic, title: "Dialect & Voice", text: "Every faction sounds different." },
  { icon: IconClock, title: "Time-Shift", text: "Rewind any entry to another era." },
  { icon: IconTag, title: "Auto-Tag", text: "Tagged quietly as your world grows." },
];

// api.js's req() throws an Error whose message is "API POST /path -> 502: <raw body>".
// The raw body is FastAPI's {"detail": "..."} JSON. Pull the actual reason out of it
// so a failed custom-world generation shows *why* instead of a silent "offline" state.
function extractErrorDetail(err) {
  const msg = (err && err.message) || "";
  const braceIdx = msg.indexOf("{");
  if (braceIdx !== -1) {
    try {
      const parsed = JSON.parse(msg.slice(braceIdx));
      if (parsed && typeof parsed.detail === "string") return parsed.detail;
    } catch {
      // body wasn't JSON (e.g. a network-level failure) -- fall through to the raw message
    }
  }
  return msg || "unknown error";
}

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
  const [customErrorReason, setCustomErrorReason] = useState("");

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
    setCustomErrorReason("");
    try {
      const data = await generateCustomPersona(customDesc.trim());
      const built = {
        id: "custom",
        label: data.personaLabel || "Custom world",
        desc: customDesc.trim(),
        // No writer-typed timeline anymore -- the AI always chooses the eras.
        eras: Array.isArray(data.eras) && data.eras.length >= 2
          ? data.eras
          : ["Act One", "Act Two", "Act Three"],
        nameIdeas: Array.isArray(data.nameIdeas) ? data.nameIdeas : [],
        dialects: {},
        ideas: Array.isArray(data.ideas) ? data.ideas : [],
        seed: Array.isArray(data.seed) ? data.seed : [],
      };
      setPersona(built);
      setStep(2);
    } catch (err) {
      // Offline fallback — fall back to a generic 3-act placeholder timeline
      // when the service is unreachable. Also surface *why* it failed -- the
      // two most common causes are the model call erroring out
      // (network/auth/rate-limit) or the JSON response getting truncated
      // past max_tokens (parse_json has no partial-repair path, so a
      // truncation loses the whole persona, not just the seed).
      setCustomOffline(true);
      setCustomErrorReason(extractErrorDetail(err));
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

  const customCharsNeeded = Math.max(0, 10 - customDesc.trim().length);

  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
      <button className="icon-btn" onClick={toggleTheme} style={{ position: "absolute", top: 28, right: 32, zIndex: 5 }} aria-label="Toggle theme" title="Switch between light and dark mode">
        {mode === "dark" ? <IconSun /> : <IconMoon />}
      </button>

      <div className="onboarding-hero" style={{ padding: "56px 64px 40px", maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
          <div className="brand-mark" style={{ width: 40, height: 40 }} />
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--text-dim)", letterSpacing: "0.02em" }}>Backlot</div>
        </div>
        <h1 style={{ fontSize: 34, lineHeight: 1.18, marginBottom: 14 }}>
          Give it a name, a scene, half an idea.
        </h1>
        <p style={{ fontSize: 15.5, color: "var(--text-dim)", lineHeight: 1.7 }}>
          It builds the lore around it using what you've already established. Ask to see
          the same world in a different era, and it still holds together.
        </p>
      </div>

      <hr className="filmstrip-divider" style={{ margin: 0 }} />
      <div className="cap-reel">
        {CAPABILITIES.map((c, i) => (
          <div key={c.title} className="cap-frame">
            <div className="slate-number cap-slate">{String(i + 1).padStart(2, "0")}</div>
            <c.icon width={20} height={20} className="cap-icon" />
            <div className="cap-title">{c.title}</div>
            <div className="cap-desc">{c.text}</div>
          </div>
        ))}
      </div>
      <hr className="filmstrip-divider" style={{ margin: 0 }} />

      <div className="onboarding-wizard" style={{ padding: "48px 64px 64px", display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: 640, width: "100%" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: i <= step ? "var(--accent)" : "var(--border)" }} />
            ))}
          </div>

          {step === 0 && (
            <div className="fade-in">
              <div className="section-label">Step 1 of 3</div>
              <h2 style={{ fontSize: 24, marginBottom: 6 }}>What describes you?</h2>
              <p style={{ color: "var(--text-dim)", fontSize: 14.5, marginBottom: 20 }}>Pick all that apply. Wearing several hats is normal, the app blends them.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => toggleRole(r.id)}
                    title={r.blurb}
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
              <Btn variant="primary" disabled={!roles.length} onClick={() => setStep(1)} title="Continue to choosing your world's style">
                Continue {roles.length ? `with ${roles.length} role${roles.length > 1 ? "s" : ""}` : ""} <IconArrowRight width={16} height={16} />
              </Btn>
            </div>
          )}

          {step === 1 && (
            <div className="fade-in">
              <div className="section-label">Step 2 of 3</div>
              <h2 style={{ fontSize: 24, marginBottom: 6 }}>What kind of world?</h2>
              <p style={{ color: "var(--text-dim)", fontSize: 14.5, marginBottom: 20 }}>This sets your starting canon, eras, and voice. You can change it later. Hover a card for the full description.</p>

              {/* Three columns of compact cards -- the description is
                  clipped to one line (full text lives in the native title
                  tooltip, same pattern the roles step already uses) so eight
                  presets fit in three short rows instead of running long.
                  minWidth: 0 on the button below is load-bearing: CSS Grid
                  items default to min-width: auto, which sizes the track to
                  the intrinsic min-content of the nowrap description text
                  (i.e. its full unwrapped length) and blows the grid out
                  horizontally past the 640px wizard column. minWidth: 0
                  overrides that so the 1fr tracks actually divide evenly
                  and the ellipsis on the description can actually engage.
                  Responsive: drops to 2 columns under 760px, 1 under 480px
                  -- see the .persona-grid media queries at the bottom of
                  this file. */}
              <div className="persona-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
                {PERSONAS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handlePickPersona(p)}
                    title={p.desc}
                    style={{ display: "block", minWidth: 0, textAlign: "left", padding: "12px 13px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", color: "var(--text)" }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.25 }}>{p.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.desc}</div>
                  </button>
                ))}
              </div>

              {/* Describe your own world -- kept as its own full-width row
                  rather than a grid cell, so the reveal below it (textarea +
                  Generate) doesn't have to fight the grid for space. */}
              <button
                onClick={() => setShowCustom((v) => !v)}
                title="Describe your own world in a few sentences instead of picking a preset"
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "16px 18px",
                  borderRadius: "var(--radius)",
                  border: `1px solid ${showCustom ? "var(--accent)" : "var(--border)"}`,
                  background: showCustom ? "var(--accent-soft)" : "var(--surface)",
                  cursor: "pointer", color: "var(--text)", marginBottom: 24,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 15.5 }}>Describe your own world</div>
                <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>A few sentences: we'll build the structure around your idea</div>
              </button>

              {showCustom && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 2px", marginBottom: 24 }}>
                  <textarea
                    value={customDesc}
                    onChange={(e) => setCustomDesc(e.target.value)}
                    placeholder="A few sentences about the world you want: genre, era, what's at stake…"
                    rows={4}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      padding: "12px 14px", borderRadius: "var(--radius)",
                      border: "1px solid var(--border)", background: "var(--surface)",
                      color: "var(--text)", fontSize: 14, lineHeight: 1.6,
                      resize: "vertical", fontFamily: "inherit",
                    }}
                  />
                  {/* Generate stays disabled under 10 characters -- this line is
                      the fix for that reading as "broken": it says why, and
                      counts down live instead of just sitting greyed out. */}
                  <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                    {customCharsNeeded > 0
                      ? `${customCharsNeeded} more character${customCharsNeeded === 1 ? "" : "s"}, then Generate turns on.`
                      : " "}
                  </div>
                  <Btn
                    variant="primary"
                    disabled={customDesc.trim().length < 10 || customGenerating}
                    onClick={handleCustomGenerate}
                    title="Generate a starting world from your description"
                  >
                    {customGenerating ? "Generating…" : "Generate"} <IconArrowRight width={16} height={16} />
                  </Btn>
                </div>
              )}
              <Btn onClick={() => setStep(0)} title="Back to choosing your roles">Back</Btn>
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
                  Generated offline. Eras and seed entries will be placeholders. You can refine them later.
                  {customErrorReason && (
                    <div style={{ marginTop: 6, color: "var(--text-faint)" }}>
                      Reason: {customErrorReason}
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <Btn small onClick={() => { setStep(1); setShowCustom(true); }} title="Go back and try generating this world again">
                      Try again
                    </Btn>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {persona.nameIdeas.map((n) => <Chip key={n} active={name === n} onClick={() => setName(n)}>{n}</Chip>)}
              </div>
              <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Or type your own name…" style={{ marginBottom: 20 }} />
              <div style={{ display: "flex", gap: 10 }}>
                <Btn onClick={() => { setStep(1); setCustomOffline(false); }} title="Back to choosing your world's style">Back</Btn>
                <Btn variant="primary" disabled={!name.trim()} title="Save this world and start building" onClick={() => onDone({
                  name: name.trim(), roles, personaId: persona.id, personaLabel: persona.label,
                  description: persona.desc || "",
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
        @media (max-width: 640px) {
          .onboarding-hero, .onboarding-wizard { padding-left: 26px !important; padding-right: 26px !important; }
        }
        @media (max-width: 760px) {
          .persona-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 480px) {
          .persona-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
