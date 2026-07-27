import { useState, useRef, useEffect } from "react";
import { generateAsset, ask, generatePortrait } from "../lib/api";
import { offlineAnswer, offlineAsset } from "../lib/generation";
import { speak, stopSpeaking, voiceSupported, recognitionSupported, startListening } from "../lib/voice";
import { portraitUrl, preloadExpressions, hasPortrait } from "../lib/portrait";
import { Chip, Field, Btn, Busy, EmptyState } from "../components/ui";
import { IconMic, IconPlus } from "../components/Icons";
import AssetCard from "../components/AssetCard";

const SUGGESTED = [
  "What is the most dangerous place here?",
  "Who has the most to lose?",
  "What does everyone get wrong about this world?",
  "What happened in the earliest era?",
];

export default function Characters({ world, assets, addAsset }) {
  const characters = assets.filter((a) => a.type === "character");
  const [mode, setMode] = useState("lore");
  const [threads, setThreads] = useState({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [showNewCard, setShowNewCard] = useState(null);
  const [npcPrompt, setNpcPrompt] = useState("");
  const [showTraits, setShowTraits] = useState(false);
  const [traitGender, setTraitGender] = useState("");
  const [traitAge, setTraitAge] = useState("");
  const [traitAppearance, setTraitAppearance] = useState("");
  const [traitPersonality, setTraitPersonality] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [portraitBusy, setPortraitBusy] = useState(false);
  const scrollRef = useRef(null);
  const recRef = useRef(null);
  const thread = threads[mode] || [];
  const activeChar = characters.find((c) => String(c.id) === mode);

  // The portrait's current expression follows the emotion tag on the
  // character's most recent reply (defaults to neutral before any reply).
  const lastAi = [...thread].reverse().find((m) => m.role === "ai");
  const expression = (lastAi && lastAi.emotion) || "neutral";

  // Portrait image lifecycle. Pollinations renders on first fetch and its
  // anonymous tier is rate-limited (~1 req/15s), so a request can fail when
  // several fire close together (e.g. two portraits generated back to back).
  // If an expression variant fails we quietly fall back to the already-cached
  // neutral portrait; if even neutral fails we show a Retry state instead of
  // the browser's broken-image icon.
  const [imgState, setImgState] = useState("loading"); // "loading" | "ok" | "error"
  const [exprOverride, setExprOverride] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const effExpression = exprOverride || expression;
  const headerUrl = activeChar ? portraitUrl(activeChar, effExpression) : null;

  useEffect(() => {
    setImgState("loading");
    setExprOverride(null);
  }, [expression, mode, activeChar?.portraitSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, busy]);

  // Cache-warm the expression variants (staggered — see portrait.js) once a
  // portrait exists, so emotion swaps don't hit a cold multi-second render.
  useEffect(() => {
    if (activeChar && hasPortrait(activeChar)) return preloadExpressions(activeChar);
  }, [activeChar?.portraitPrompt, activeChar?.portraitSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching conversations mid-sentence shouldn't leave the old character's
  // voice talking over the new one.
  useEffect(() => {
    stopSpeaking();
    setSpeaking(false);
  }, [mode]);

  function speakLine(text) {
    speak(text, activeChar?.faction, world.dialects, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    });
  }

  function toggleListening() {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    setListening(true);
    recRef.current = startListening({
      onResult: (transcript) => send(transcript),
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
  }

  async function makePortrait() {
    if (!activeChar || portraitBusy) return;
    setPortraitBusy(true);
    try {
      const res = await generatePortrait(world.id, activeChar.id);
      addAsset(res.asset);
    } catch (_e) {
      // non-fatal — the chat still works without a portrait
    }
    setPortraitBusy(false);
  }

  function collectTraits() {
    const traits = {};
    if (traitGender.trim()) traits.gender = traitGender.trim();
    if (traitAge.trim()) traits.age = traitAge.trim();
    if (traitAppearance.trim()) traits.appearance = traitAppearance.trim();
    if (traitPersonality.trim()) traits.personality = traitPersonality.trim();
    return Object.keys(traits).length ? traits : undefined;
  }

  function clearTraits() {
    setTraitGender(""); setTraitAge(""); setTraitAppearance(""); setTraitPersonality("");
  }

  async function generateNpc() {
    const text = npcPrompt.trim();
    setGenBusy(true); setShowNewCard(null);
    try {
      const res = await generateAsset(world.id, "character", { fragment: text, traits: collectTraits() });
      addAsset(res.asset); setShowNewCard(res.asset); setMode(String(res.asset.id));
      setNpcPrompt(""); clearTraits();
    } catch (e) {
      const draftAsset = offlineAsset(
        text || "a new figure connected to this world",
        world, assets, "character"
      );
      addAsset(draftAsset); setShowNewCard(draftAsset); setMode(String(draftAsset.id));
      setNpcPrompt(""); clearTraits();
    }
    setGenBusy(false);
  }

  async function send(textOverride) {
    const q = (textOverride ?? draft).trim();
    if (!q) return;
    const next = [...thread, { role: "user", text: q }];
    setThreads({ ...threads, [mode]: next });
    setDraft(""); setBusy(true);
    try {
      const res = await ask(world.id, mode, q, next.slice(0, -1));
      setThreads((t) => ({ ...t, [mode]: [...next, { role: "ai", text: res.reply, emotion: res.emotion || "neutral" }] }));
      if (autoSpeak && mode !== "lore" && voiceSupported()) speakLine(res.reply);
    } catch (e) {
      const fallback = mode === "lore"
        ? offlineAnswer(q, assets)
        : `${activeChar?.title || "They"} says nothing — the service is unreachable right now (${e.message}).`;
      setThreads((t) => ({ ...t, [mode]: [...next, { role: "ai", text: fallback }] }));
    }
    setBusy(false);
  }

  return (
    <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24, height: "calc(100vh - var(--topbar-h) - var(--space-6) * 2)" }} id="chars-grid">
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, marginBottom: 4 }}>Characters</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-dim)" }}>Ask about the world, or chat with anyone you've created.</p>
        </div>
        <Field
          value={npcPrompt}
          onChange={(e) => setNpcPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !genBusy && generateNpc()}
          placeholder="Or describe a character…"
          style={{ marginBottom: 8 }}
        />
        <button
          type="button"
          onClick={() => setShowTraits((v) => !v)}
          title="Optionally lock in gender, age, appearance, or personality before generating"
          style={{
            background: "none", border: "none", cursor: "pointer", textAlign: "left",
            color: "var(--accent-strong)", fontSize: 12.5, padding: "0 2px", marginBottom: 8,
          }}
        >
          {showTraits ? "▾ Hide details" : "▸ Pin down details (gender, age, looks, personality)"}
        </button>
        {showTraits && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            <Field value={traitGender} onChange={(e) => setTraitGender(e.target.value)} placeholder="Gender (blank = AI decides)" />
            <Field value={traitAge} onChange={(e) => setTraitAge(e.target.value)} placeholder="Age (e.g. 17, mid-40s, ancient)" />
            <Field area rows={2} value={traitAppearance} onChange={(e) => setTraitAppearance(e.target.value)} placeholder="Appearance — also feeds their portrait" />
            <Field area rows={2} value={traitPersonality} onChange={(e) => setTraitPersonality(e.target.value)} placeholder="Personality / characteristics" />
          </div>
        )}
        <Btn variant="primary" onClick={generateNpc} disabled={genBusy} title="Create a new NPC using the description and details above" style={{ marginBottom: 14, width: "100%", justifyContent: "center" }}>
          <IconPlus width={16} height={16} /> {genBusy ? "Creating…" : "Generate a new character"}
        </Btn>
        <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => setMode("lore")}
            className={`nav-item ${mode === "lore" ? "active" : ""}`}
            title="Ask questions answered only from your World Book"
            style={{ background: mode === "lore" ? "var(--accent-soft)" : "var(--surface)", border: "1px solid var(--border-soft)" }}
          >
            🌍 Ask about the world
          </button>
          {characters.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-faint)", padding: "12px 4px" }}>No characters yet — generate one above to start a conversation.</p>
          )}
          {characters.map((c) => (
            <button
              key={c.id}
              onClick={() => setMode(String(c.id))}
              className={`nav-item ${mode === String(c.id) ? "active" : ""}`}
              title={`Chat with ${c.title}`}
              style={{ background: mode === String(c.id) ? "var(--accent-soft)" : "var(--surface)", border: "1px solid var(--border-soft)" }}
            >
              🧑 {c.title}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {mode !== "lore" && activeChar && (
          <div className="card" style={{ marginBottom: 14, padding: 14, display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              {hasPortrait(activeChar) ? (
                <>
                  <div className={`portrait-frame ${speaking ? "talking" : ""} ${busy ? "pondering" : ""} ${imgState === "loading" ? "img-loading" : ""}`}>
                    {imgState !== "error" ? (
                      <img
                        key={`${activeChar.id}-${effExpression}-${retryNonce}`}
                        src={headerUrl}
                        alt={`${activeChar.title} — ${effExpression}`}
                        className="portrait-img"
                        title={`Expression: ${effExpression} — click to view full size`}
                        style={{ cursor: "pointer" }}
                        onClick={() => window.open(headerUrl, "_blank", "noopener")}
                        onLoad={() => setImgState("ok")}
                        onError={() => {
                          if (effExpression !== "neutral") {
                            setExprOverride("neutral");
                            setImgState("loading");
                          } else {
                            setImgState("error");
                          }
                        }}
                      />
                    ) : (
                      <div className="portrait-error">
                        <div style={{ fontSize: 20 }}>🖼️</div>
                        <div style={{ fontSize: 11, lineHeight: 1.35, padding: "0 8px", textAlign: "center" }}>
                          Image service is busy (rate limit) — wait ~15s
                        </div>
                        <Btn small onClick={() => { setImgState("loading"); setRetryNonce((n) => n + 1); }} title="Try loading the portrait again">
                          Retry
                        </Btn>
                      </div>
                    )}
                  </div>
                  <button
                    className="icon-btn"
                    style={{ width: 24, height: 24, fontSize: 12 }}
                    onClick={makePortrait}
                    disabled={portraitBusy}
                    title="Repaint this portrait (new face)"
                    aria-label="Regenerate portrait"
                  >
                    {portraitBusy ? "…" : "↻"}
                  </button>
                </>
              ) : (
                <Btn small onClick={makePortrait} disabled={portraitBusy} title="Generate a portrait for this character">
                  {portraitBusy ? "Painting…" : "🎨 Portrait"}
                </Btn>
              )}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5, flex: 1 }}>
              <strong style={{ color: "var(--text)" }}>{activeChar.title}</strong> · {activeChar.faction} · {activeChar.era} — {activeChar.content}
              {voiceSupported() && (
                <div style={{ marginTop: 8 }}>
                  <Chip
                    active={autoSpeak}
                    onClick={() => {
                      if (autoSpeak) stopSpeaking();
                      setAutoSpeak(!autoSpeak);
                    }}
                    title="Automatically read this character's replies aloud"
                  >
                    🔊 Speak replies aloud
                  </Chip>
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "lore" && thread.length === 0 && (
          <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SUGGESTED.map((s) => <Chip key={s} onClick={() => send(s)}>{s}</Chip>)}
          </div>
        )}

        <div ref={scrollRef} className="card" style={{ flex: 1, overflowY: "auto", marginBottom: 12, minHeight: 200 }}>
          {thread.length === 0 && (
            <EmptyState
              icon={mode === "lore" ? "💬" : "🧑"}
              title={mode === "lore" ? "Ask anything about your world" : `Say hello to ${activeChar?.title}`}
              text={mode === "lore" ? "Answers come only from what's in your World Book." : "They'll reply in character, consistent with your canon."}
            />
          )}
          {thread.map((m, i) => (
            <div key={i} style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 3 }}>
                {m.role === "user" ? "You" : mode === "lore" ? world.personaLabel : activeChar?.title}
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, maxWidth: "85%" }}>
                {m.role === "ai" && mode !== "lore" && hasPortrait(activeChar) && (
                  // Always the neutral variant: it's the one URL guaranteed to
                  // be warm in the browser cache (the header loads it first),
                  // so bubble avatars never spend rate-limit budget of their
                  // own. Hidden entirely if it somehow still fails — a broken
                  // icon is worse than no avatar.
                  <img
                    src={portraitUrl(activeChar, "neutral")}
                    alt=""
                    className="bubble-avatar"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                )}
                <div style={{
                  fontSize: 14.5, lineHeight: 1.6, color: "var(--text)",
                  background: m.role === "user" ? "var(--accent-soft)" : "var(--raised)",
                  padding: "10px 14px", borderRadius: 12,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  {m.text}
                  {m.role === "ai" && mode !== "lore" && voiceSupported() && (
                    <button
                      className="icon-btn"
                      style={{ width: 26, height: 26, flexShrink: 0 }}
                      onClick={() => speakLine(m.text)}
                      aria-label="Hear this line"
                      title="Hear this line spoken in the faction's voice"
                    >
                      <IconMic width={13} height={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {busy && <Busy label="thinking…" />}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {mode !== "lore" && recognitionSupported() && (
            <Btn
              onClick={toggleListening}
              disabled={busy}
              variant={listening ? "primary" : undefined}
              style={listening ? { animation: "listenpulse 1.2s ease-in-out infinite" } : undefined}
              title={listening ? "Stop listening" : "Speak to this character instead of typing"}
            >
              {listening ? "● Listening…" : "🎤"}
            </Btn>
          )}
          <Field value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={mode === "lore" ? "Type your question…" : listening ? "Listening — just talk…" : "Say something…"} />
          <Btn variant="primary" onClick={() => send()} disabled={busy || !draft.trim()} title="Send your message">Send</Btn>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) { #chars-grid { grid-template-columns: 1fr !important; height: auto !important; } }
        .portrait-frame {
          position: relative; width: 148px; height: 148px; border-radius: 16px;
          overflow: hidden; border: 2px solid var(--border);
          background: var(--bg-elevated);
          animation: breathe 4.5s ease-in-out infinite;
        }
        .portrait-frame.img-loading {
          background: linear-gradient(100deg, var(--bg-elevated) 40%, var(--raised) 50%, var(--bg-elevated) 60%);
          background-size: 200% 100%;
          animation: breathe 4.5s ease-in-out infinite, shimmer 1.4s linear infinite;
        }
        .portrait-error {
          width: 100%; height: 100%; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 6px;
          color: var(--text-dim);
        }
        @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        .portrait-frame.talking {
          border-color: var(--accent);
          animation: breathe 4.5s ease-in-out infinite, talkglow 0.45s ease-in-out infinite alternate;
        }
        .portrait-frame.pondering { opacity: 0.75; filter: saturate(0.6); }
        .portrait-img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .bubble-avatar {
          width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
          flex-shrink: 0; border: 1px solid var(--border);
        }
        @keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.02); } }
        @keyframes talkglow {
          from { box-shadow: 0 0 4px 1px var(--accent-soft); }
          to   { box-shadow: 0 0 16px 5px var(--accent-soft); }
        }
        @keyframes listenpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
      `}</style>
    </div>
  );
}
