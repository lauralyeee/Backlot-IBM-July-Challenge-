import { useState, useRef, useEffect } from "react";
import { generateAsset, ask } from "../lib/api";
import { offlineAnswer, offlineAsset } from "../lib/generation";
import { speak, voiceSupported } from "../lib/voice";
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
  const scrollRef = useRef(null);
  const thread = threads[mode] || [];
  const activeChar = characters.find((c) => String(c.id) === mode);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, busy]);

  async function generateNpc() {
    const text = npcPrompt.trim();
    setGenBusy(true); setShowNewCard(null);
    try {
      const res = await generateAsset(world.id, "character", { fragment: text });
      addAsset(res.asset); setShowNewCard(res.asset); setMode(String(res.asset.id));
      setNpcPrompt("");
    } catch (e) {
      const draftAsset = offlineAsset(
        text || "a new figure connected to this world",
        world, assets, "character"
      );
      addAsset(draftAsset); setShowNewCard(draftAsset); setMode(String(draftAsset.id));
      setNpcPrompt("");
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
      setThreads((t) => ({ ...t, [mode]: [...next, { role: "ai", text: res.reply }] }));
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
        <Btn variant="primary" onClick={generateNpc} disabled={genBusy} style={{ marginBottom: 14, width: "100%", justifyContent: "center" }}>
          <IconPlus width={16} height={16} /> {genBusy ? "Creating…" : "Generate a new character"}
        </Btn>
        <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => setMode("lore")}
            className={`nav-item ${mode === "lore" ? "active" : ""}`}
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
              style={{ background: mode === String(c.id) ? "var(--accent-soft)" : "var(--surface)", border: "1px solid var(--border-soft)" }}
            >
              🧑 {c.title}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {mode !== "lore" && activeChar && (
          <div className="card" style={{ marginBottom: 14, padding: 14, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--text)" }}>{activeChar.title}</strong> · {activeChar.faction} · {activeChar.era} — {activeChar.content}
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
              <div style={{
                fontSize: 14.5, lineHeight: 1.6, color: "var(--text)", maxWidth: "80%",
                background: m.role === "user" ? "var(--accent-soft)" : "var(--raised)",
                padding: "10px 14px", borderRadius: 12,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {m.text}
                {m.role === "ai" && mode !== "lore" && voiceSupported() && (
                  <button
                    className="icon-btn"
                    style={{ width: 26, height: 26, flexShrink: 0 }}
                    onClick={() => speak(m.text, activeChar?.faction, world.dialects)}
                    aria-label="Hear this line"
                    title="Hear this line spoken in the faction's voice"
                  >
                    <IconMic width={13} height={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {busy && <Busy label="thinking…" />}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <Field value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={mode === "lore" ? "Type your question…" : "Say something…"} />
          <Btn variant="primary" onClick={() => send()} disabled={busy || !draft.trim()}>Send</Btn>
        </div>
      </div>

      <style>{`@media (max-width: 900px) { #chars-grid { grid-template-columns: 1fr !important; height: auto !important; } }`}</style>
    </div>
  );
}
