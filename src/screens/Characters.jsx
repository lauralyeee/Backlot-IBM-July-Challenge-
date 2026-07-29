import { useState, useRef, useEffect } from "react";
import { generateAsset, ask, generatePortrait, designCharacterVoice, confirmCharacterVoice, listRelationships } from "../lib/api";
import { offlineAsset } from "../lib/generation";
import { speakAsCharacterOrFallback, stopSpeaking, voiceSupported } from "../lib/voice";
import { portraitUrl, preloadExpressions, hasPortrait } from "../lib/portrait";
import { Field, Chip, Btn, Busy, EmptyState } from "../components/ui";
import { IconMic, IconPlus, IconPerson, IconImage, IconRefresh, IconSpeaker, IconPlay, IconChevronDown, IconChevronUp } from "../components/Icons";
import AssetCard from "../components/AssetCard";

export default function Characters({ world, assets, addAsset }) {
  const characters = assets.filter((a) => a.type === "character");
  // "Ask about the world" now lives on the World Book screen -- this screen
  // is purely for chatting with characters, so the selected id always
  // points at one (or is null when there's no cast yet).
  const [mode, setMode] = useState(characters[0] ? String(characters[0].id) : null);
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
  // Tracks which line is currently loading/playing so the mic button (and a
  // caption under the line) can show it instead of leaving the user
  // guessing during the gap between pressing play and audio actually
  // starting -- see speakLine() below. key is a thread message index, or
  // "auto" for the "Speak replies aloud" auto-play path; phase is
  // "loading" while waiting on the AI voice, then "speaking" once it starts.
  const [voiceStatus, setVoiceStatus] = useState({ key: null, phase: null });
  const [portraitBusy, setPortraitBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voicePreview, setVoicePreview] = useState(null); // { voiceDescription, voiceId, voiceName, audioBase64 }
  const [triedVoiceIds, setTriedVoiceIds] = useState([]); // so "try again" doesn't repeat a voice
  const [voiceConfirmBusy, setVoiceConfirmBusy] = useState(false);
  const previewAudioRef = useRef(null);
  const scrollRef = useRef(null);
  const thread = threads[mode] || [];
  const activeChar = characters.find((c) => String(c.id) === mode);

  // Relationships persisted via Import's script-ingestion flow (Feature 1
  // extension) -- fetched once per world and filtered client-side to
  // whichever ones mention the currently active character.
  const [relationships, setRelationships] = useState([]);

  useEffect(() => {
    let cancelled = false;
    listRelationships(world.id).then((rels) => { if (!cancelled) setRelationships(rels); }).catch(() => {});
    return () => { cancelled = true; };
  }, [world.id]);

  const charRelationships = activeChar
    ? relationships.filter(
        (r) => r.a.toLowerCase() === activeChar.title.toLowerCase() || r.b.toLowerCase() === activeChar.title.toLowerCase()
      )
    : [];

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
    setVoicePreview(null);
    setTriedVoiceIds([]);
    setVoiceStatus({ key: null, phase: null });
  }, [mode]);

  function speakLine(text, key = "auto") {
    // Uses the character's cast AI voice if one exists, falling back to
    // Web Speech automatically (no cast yet, Gemini quota exhausted,
    // network error) -- see speakAsCharacterOrFallback() in lib/voice.js.
    // There's real buffer time between calling this and audio actually
    // starting (a network round trip plus TTS synthesis), so voiceStatus
    // flips to "loading" right away instead of leaving the button looking
    // inert -- a user pressing play again mid-request was the bug report
    // this is fixing.
    setVoiceStatus({ key, phase: "loading" });
    speakAsCharacterOrFallback(world.id, activeChar, text, world.dialects, {
      onStart: () => { setSpeaking(true); setVoiceStatus({ key, phase: "speaking" }); },
      onEnd: () => { setSpeaking(false); setVoiceStatus({ key: null, phase: null }); },
    });
  }

  // Voice casting -- mirrors makePortrait()'s shape: generate/preview,
  // regenerate as many times as wanted, nothing persisted until confirmed.
  function playVoicePreview(b64) {
    previewAudioRef.current?.pause();
    const audio = new Audio(`data:audio/wav;base64,${b64}`);
    previewAudioRef.current = audio;
    audio.play().catch(() => {});
  }

  async function castVoice() {
    if (!activeChar || voiceBusy) return;
    setVoiceBusy(true);
    try {
      // Excludes voices already previewed this casting session so
      // "try again" actually gives a different one, not the same match.
      const res = await designCharacterVoice(world.id, activeChar.id, triedVoiceIds);
      setVoicePreview({
        voiceDescription: res.voiceDescription,
        voiceId: res.voiceId,
        voiceName: res.voiceName,
        audioBase64: res.audioBase64,
      });
      setTriedVoiceIds((ids) => [...ids, res.voiceId]);
      playVoicePreview(res.audioBase64);
    } catch (_e) {
      // non-fatal -- chat still works with Web Speech if casting fails
    }
    setVoiceBusy(false);
  }

  async function confirmVoice() {
    if (!activeChar || !voicePreview || voiceConfirmBusy) return;
    setVoiceConfirmBusy(true);
    try {
      const res = await confirmCharacterVoice(
        world.id, activeChar.id, voicePreview.voiceId, voicePreview.voiceDescription
      );
      addAsset(res.asset);
      setVoicePreview(null);
      setTriedVoiceIds([]);
    } catch (_e) {
      // leave the preview up so Confirm can be retried
    }
    setVoiceConfirmBusy(false);
  }

  function discardVoicePreview() {
    previewAudioRef.current?.pause();
    setVoicePreview(null);
    setTriedVoiceIds([]);
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
    if (!q || !activeChar) return;
    const next = [...thread, { role: "user", text: q }];
    setThreads({ ...threads, [mode]: next });
    setDraft(""); setBusy(true);
    try {
      const res = await ask(world.id, mode, q, next.slice(0, -1));
      setThreads((t) => ({ ...t, [mode]: [...next, { role: "ai", text: res.reply, emotion: res.emotion || "neutral" }] }));
      if (autoSpeak && voiceSupported()) speakLine(res.reply, next.length);
    } catch (e) {
      const fallback = `${activeChar?.title || "They"} says nothing. The service is unreachable right now (${e.message}).`;
      setThreads((t) => ({ ...t, [mode]: [...next, { role: "ai", text: fallback }] }));
    }
    setBusy(false);
  }

  return (
    <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24, height: "calc(100vh - var(--space-6) * 2)" }} id="chars-grid">
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 28, marginBottom: 6 }}>Characters</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-dim)" }}>Chat with anyone you've created. Pick someone from your cast, or generate someone new.</p>
        </div>
        <Field
          area
          rows={3}
          value={npcPrompt}
          onChange={(e) => setNpcPrompt(e.target.value)}
          placeholder="Describe a character, as much or as little as you want…"
          style={{ marginBottom: 8 }}
        />
        <button
          type="button"
          onClick={() => setShowTraits((v) => !v)}
          title="Optionally lock in gender, age, appearance, or personality before generating"
          style={{
            background: "none", border: "none", cursor: "pointer", textAlign: "left",
            color: "var(--accent-strong)", fontSize: 12.5, padding: "0 2px", marginBottom: 8,
            display: "inline-flex", alignItems: "center", gap: 5,
          }}
        >
          {showTraits ? <IconChevronUp width={12} height={12} /> : <IconChevronDown width={12} height={12} />}
          {showTraits ? "Hide details" : "Pin down details (gender, age, looks, personality)"}
        </button>
        {showTraits && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            <Field value={traitGender} onChange={(e) => setTraitGender(e.target.value)} placeholder="Gender (blank = AI decides)" />
            <Field value={traitAge} onChange={(e) => setTraitAge(e.target.value)} placeholder="Age, e.g. 17, mid-40s, ancient (blank = AI decides)" />
            <Field area rows={2} value={traitAppearance} onChange={(e) => setTraitAppearance(e.target.value)} placeholder="Appearance, also feeds their portrait (blank = AI decides)" />
            <Field area rows={2} value={traitPersonality} onChange={(e) => setTraitPersonality(e.target.value)} placeholder="Personality / characteristics (blank = AI decides)" />
          </div>
        )}
        <Btn variant="primary" onClick={generateNpc} disabled={genBusy} title="Create a new character using the description and details above" style={{ marginBottom: 14, width: "100%", justifyContent: "center" }}>
          <IconPlus width={16} height={16} /> {genBusy ? "Creating…" : "Generate a new character"}
        </Btn>
        <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          {characters.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-faint)", padding: "12px 4px" }}>No characters yet. Generate one above to start a conversation.</p>
          )}
          {characters.map((c) => (
            <button
              key={c.id}
              onClick={() => setMode(String(c.id))}
              className={`nav-item ${mode === String(c.id) ? "active" : ""}`}
              title={`Chat with ${c.title}`}
              style={{ background: mode === String(c.id) ? "var(--accent-soft)" : "var(--surface)", border: "1px solid var(--border-soft)" }}
            >
              <IconPerson width={15} height={15} /> {c.title}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!activeChar ? (
          <div className="card" style={{ flex: 1, display: "flex" }}>
            <EmptyState icon={IconPerson} title="No character selected" text="Generate a character on the left, or pick one from your cast, to start a conversation." />
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 14, padding: 14, display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                {hasPortrait(activeChar) ? (
                  <>
                    <div className={`portrait-frame ${speaking ? "talking" : ""} ${busy ? "pondering" : ""} ${imgState === "loading" ? "img-loading" : ""}`}>
                      {imgState !== "error" ? (
                        <img
                          key={`${activeChar.id}-${effExpression}-${retryNonce}`}
                          src={headerUrl}
                          alt={`${activeChar.title}, ${effExpression}`}
                          className="portrait-img"
                          title={`Expression: ${effExpression} (click to view full size)`}
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
                          <IconImage width={22} height={22} style={{ opacity: 0.6 }} />
                          <div style={{ fontSize: 11, lineHeight: 1.35, padding: "0 8px", textAlign: "center" }}>
                            Image service is busy (rate limit), wait ~15s
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
                      {portraitBusy ? "…" : <IconRefresh width={13} height={13} />}
                    </button>
                  </>
                ) : (
                  <Btn small onClick={makePortrait} disabled={portraitBusy} title="Generate a portrait for this character">
                    <IconImage width={14} height={14} /> {portraitBusy ? "Painting…" : "Portrait"}
                  </Btn>
                )}
              </div>
              <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5, flex: 1 }}>
                <strong style={{ color: "var(--text)" }}>{activeChar.title}</strong> · {activeChar.faction} · {activeChar.era}: {activeChar.content}
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
                      <IconSpeaker width={13} height={13} className={voiceStatus.key === "auto" ? (voiceStatus.phase === "loading" ? "icon-pulse" : "icon-wave") : ""} />
                      {" "}Speak replies aloud
                      {voiceStatus.key === "auto" && (
                        <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.75 }}>
                          {voiceStatus.phase === "loading" ? "· loading voice…" : "· speaking…"}
                        </span>
                      )}
                    </Chip>
                  </div>
                )}
                {voiceSupported() && (
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {!activeChar.voiceId && !voicePreview && (
                      <Btn small onClick={castVoice} disabled={voiceBusy} title="Generate an AI voice for this character, and preview it before it's used">
                        <IconMic width={13} height={13} /> {voiceBusy ? "Casting…" : "Cast a voice"}
                      </Btn>
                    )}
                    {voicePreview && (
                      <>
                        <Btn small onClick={() => playVoicePreview(voicePreview.audioBase64)} title={`Play this voice preview again: voice "${voicePreview.voiceName}"`}>
                          <IconPlay width={12} height={12} /> Preview{voicePreview.voiceName ? ` (${voicePreview.voiceName})` : ""}
                        </Btn>
                        <Btn small variant="primary" onClick={confirmVoice} disabled={voiceConfirmBusy} title="Use this voice for all of this character's replies from now on">
                          {voiceConfirmBusy ? "Saving…" : "Use this voice"}
                        </Btn>
                        <Btn small onClick={castVoice} disabled={voiceBusy} title="Not quite right, try a different take">
                          <IconRefresh width={13} height={13} /> {voiceBusy ? "…" : "Try again"}
                        </Btn>
                        <Btn small onClick={discardVoicePreview} title="Discard this preview">
                          Cancel
                        </Btn>
                      </>
                    )}
                    {activeChar.voiceId && !voicePreview && (
                      <Btn small onClick={castVoice} disabled={voiceBusy} title="Recast this character's voice: generates a new take to preview before it replaces the current one">
                        <IconMic width={13} height={13} /> {voiceBusy ? "Casting…" : "Recast voice"}
                      </Btn>
                    )}
                  </div>
                )}
                {charRelationships.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", textTransform: "uppercase" }}>Known relationships</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {charRelationships.map((r) => {
                        const other = r.a.toLowerCase() === activeChar.title.toLowerCase() ? r.b : r.a;
                        return (
                          <div key={r.id} style={{ fontSize: 12.5 }}>
                            <strong>{other}</strong>{r.context ? `: ${r.context}` : ""}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div ref={scrollRef} className="card" style={{ flex: 1, overflowY: "auto", marginBottom: 12, minHeight: 200 }}>
              {thread.length === 0 && (
                <EmptyState
                  icon={IconPerson}
                  title={`Say hello to ${activeChar.title}`}
                  text="They'll reply in character, consistent with your canon."
                />
              )}
              {thread.map((m, i) => {
                const isActive = voiceStatus.key === i;
                const isLoading = isActive && voiceStatus.phase === "loading";
                const isSpeaking = isActive && voiceStatus.phase === "speaking";
                return (
                <div key={i} style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 3 }}>
                    {m.role === "user" ? "You" : activeChar.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8, maxWidth: "85%" }}>
                    {m.role === "ai" && hasPortrait(activeChar) && (
                      // Always the neutral variant: it's the one URL guaranteed to
                      // be warm in the browser cache (the header loads it first),
                      // so bubble avatars never spend rate-limit budget of their
                      // own. Hidden entirely if it somehow still fails, since a
                      // broken icon looks worse than no avatar at all.
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
                      {m.role === "ai" && voiceSupported() && (
                        <button
                          className="icon-btn"
                          style={{ width: 26, height: 26, flexShrink: 0 }}
                          onClick={() => speakLine(m.text, i)}
                          aria-label={isLoading ? "Loading voice" : isSpeaking ? "Speaking" : "Hear this line"}
                          title={isLoading ? "Loading voice…" : isSpeaking ? "Speaking…" : "Hear this line spoken in this character's voice"}
                        >
                          <IconMic width={13} height={13} className={isLoading ? "icon-pulse" : isSpeaking ? "icon-wave" : ""} />
                        </button>
                      )}
                    </div>
                  </div>
                  {m.role === "ai" && (isLoading || isSpeaking) && (
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                      {isLoading ? "Loading voice…" : "Speaking…"}
                    </div>
                  )}
                </div>
                );
              })}
              {busy && <Busy label="thinking…" />}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <Field value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Say something…" />
              <Btn variant="primary" onClick={() => send()} disabled={busy || !draft.trim()} title="Send your message">Send</Btn>
            </div>
          </>
        )}
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
        /* Loading (buffering on the AI voice call) vs. speaking (audio
           actually playing) get distinct animations on the mic icon itself,
           so there's a visible difference between "working on it" and
           "playing now" without needing to read the caption underneath. */
        .icon-pulse { animation: micPulse 1s ease-in-out infinite; }
        .icon-wave { animation: micWave 0.5s ease-in-out infinite alternate; color: var(--accent); }
        @keyframes micPulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
        @keyframes micWave { from { transform: scale(1); } to { transform: scale(1.22); } }
      `}</style>
    </div>
  );
}
