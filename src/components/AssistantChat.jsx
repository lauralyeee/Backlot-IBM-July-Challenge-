import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import { IconChat, IconRefresh } from "./Icons";
import { widgetChat } from "../lib/api";
import { subscribeCurrentScreen, getCurrentScreen } from "../lib/currentScreen";

/**
 * Floating chat widget — general-purpose assistant, powered by IBM Granite
 * via this app's own backend (backend/main.py → /api/widget-chat →
 * backend/watsonx.py), the same server-side credentials and model fallback
 * chain used by every other AI feature in the app.
 *
 * History: this widget originally ran on Puter.js (a keyless third-party
 * "User-Pays" proxy — no backend needed, but it shares an anonymous usage
 * pool with every other Puter app, which can run out of credits at busy
 * times: OpenRouter 402 "Insufficient credits"). Since this app already has
 * a real IBM watsonx.ai key wired up server-side for its core features, we
 * moved the widget onto that instead — no shared pool, no third-party
 * dependency, and the backend already retries and falls back across models
 * (see backend/watsonx.py MODEL_CHAIN).
 *
 * Trade-off: this now requires the FastAPI backend to be running (see
 * AGENTS.md "Running the Project"), unlike the old Puter.js version, which
 * worked from a static file with no server at all.
 *
 * This is a general-purpose assistant surface, separate from the
 * canon-grounded Ask feature (src/lib/api.js → ask() → /api/worlds/{id}/ask),
 * which remains the app's primary/showcased Granite integration per
 * AGENTS.md. This widget does not read world state.
 *
 * Mounted once in src/main.jsx so it appears on every screen.
 */
// Quick-start prompts mirroring the app's real screens (kept in sync with
// both Sidebar.jsx's nav labels and the backend's _SCREEN_LABELS /
// _WIDGET_SYSTEM_PROMPT in backend/main.py). Keyed by the same screen ids
// App.jsx reports via src/lib/currentScreen.js, so the chip suggestions
// match whatever the writer is actually looking at.
const SCREEN_SUGGESTIONS = {
  home: ["What can I do first in a new world?", "How is this app organized?"],
  canon: ["What's the World Book for?", "How does the consistency audit work?"],
  gallery: ["What kind of concept art can I generate here?", "Can I generate a 3D model of a character?"],
  create: ["How do I turn an idea fragment into a new entry?", "What kinds of entries can I add here?"],
  characters: ["Can I chat with my characters?", "How do characters stay consistent with canon?"],
  timeline: ["What does Time-Shift Mode do?", "How do I set up or rename eras?"],
  import: ["How do I import a script I already wrote?", "What file formats can I import?"],
  export: ["What does exporting give me?", "Can I export just one era or faction?"],
  settings: ["Can I rename or merge eras here?", "How do I switch light/dark mode?"],
  onboarding: ["What should I put in my world description?", "How do I get started?"],
};
const DEFAULT_SUGGESTIONS = [
  "How do I import a script I already wrote?",
  "What's the World Book for?",
  "Can I chat with my characters?",
  "What does Time-Shift Mode do?",
];
// Evergreen fallback follow-ups once the screen-specific and default pools
// run dry (asked already this session) — keeps the post-reply chip row from
// ever coming up empty.
const GENERIC_FOLLOWUPS = ["Tell me more about that", "What else can I do here?"];

// Phase A of assistant-chat-followup-engagement-plan.md: pick 2-3 follow-up
// chips to show under the latest assistant reply, so the conversation doesn't
// dead-end into a bare textarea after the first turn. Pulls from the current
// screen's suggestions first, then the general pool, then evergreen prompts,
// skipping anything the person already asked this session.
function pickFollowups(screen, usedTexts) {
  const pool = [...(SCREEN_SUGGESTIONS[screen] || []), ...DEFAULT_SUGGESTIONS, ...GENERIC_FOLLOWUPS];
  const seen = new Set();
  const out = [];
  for (const q of pool) {
    const key = q.trim().toLowerCase();
    if (seen.has(key) || usedTexts.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === 3) break;
  }
  return out;
}

export default function AssistantChat() {
  const screen = useSyncExternalStore(subscribeCurrentScreen, getCurrentScreen);
  const suggestions = SCREEN_SUGGESTIONS[screen] || DEFAULT_SUGGESTIONS;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [retryText, setRetryText] = useState("");
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Follow-up chips shown under the latest assistant reply (Phase A —
  // previously chips only existed pre-first-message, so the conversation
  // dead-ended into a bare textarea after one turn). Recomputed whenever the
  // conversation changes; excludes anything already asked this session.
  const lastMessage = messages[messages.length - 1];
  const showFollowups = !sending && !error && messages.length > 0 && lastMessage?.role === "assistant" && !!lastMessage.content;
  const usedTexts = useMemo(
    () => new Set(messages.filter((m) => m.role === "user").map((m) => m.content.trim().toLowerCase())),
    [messages]
  );
  const followups = showFollowups ? pickFollowups(screen, usedTexts) : [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, open, followups.length]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Streams the assistant's reply into a placeholder bubble token-by-token.
  // On a network-level failure (backend unreachable, connection dropped —
  // NOT a model error, which the backend already turns into a friendly
  // "temporarily unavailable" reply, same as every other AI feature in the
  // app), retries once, silently, before surfacing the error banner.
  async function streamReply(next, isAutoRetry = false) {
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const { reply, offline } = await widgetChat(
        next.map((m) => ({ role: m.role, content: m.content })),
        screen,
        (deltaText) => {
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: (last.content || "") + deltaText };
            return copy;
          });
        }
      );
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        // Fallback in case nothing streamed but a full reply still came back.
        copy[copy.length - 1] = { ...last, content: last.content || reply || "…", offline };
        return copy;
      });
      setSending(false);
    } catch (e) {
      setMessages((prev) => prev.slice(0, -1)); // drop the empty streaming placeholder

      const isNetworkError = e?.name === "TypeError" || /failed to fetch|networkerror|network/i.test(e?.message || "");

      if (isNetworkError && !isAutoRetry) {
        await streamReply(next, true); // one silent retry before bothering the user
        return;
      }

      setSending(false);
      setError(
        isNetworkError
          ? "Can't reach the app's backend. Make sure the FastAPI server is running (see AGENTS.md)."
          : e?.message || "Something went wrong reaching the assistant."
      );
      setRetryText(true);
    }
  }

  async function send(overrideText) {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;

    setError("");
    setRetryText("");

    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    if (overrideText === undefined) setInput("");
    setSending(true);

    await streamReply(next);
  }

  // Manual retry (button in the error banner): resend the same message list
  // as-is — the failed user turn is already in `messages`, so this doesn't
  // append a duplicate.
  async function retry() {
    if (sending) return;
    setError("");
    setRetryText("");
    setSending(true);
    await streamReply(messages);
  }

  // Restart: wipe the conversation and go back to the suggestion chips.
  // Disabled while a reply is streaming — streamReply()'s setMessages calls
  // assume the last array entry is the in-flight assistant bubble, so
  // clearing mid-stream would let a stray, unlabeled bubble reappear once
  // the pending delta/final update lands.
  function restartConversation() {
    if (sending) return;
    setMessages([]);
    setInput("");
    setError("");
    setRetryText("");
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close chat" : "Open chat"}
        onClick={() => setOpen((v) => !v)}
        style={styles.launcher}
      >
        {open ? "×" : <IconChat width={22} height={22} />}
      </button>

      {open && (
        <div className="fade-in" style={styles.panel} role="dialog" aria-label="Granite assistant chat">
          <div style={styles.header}>
            <div>
              <div style={styles.headerTitle}>Assistant</div>
              <div style={styles.headerSubtitle}>IBM Granite · via this app's backend</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {messages.length > 0 && (
                <button
                  type="button"
                  aria-label="Restart conversation"
                  title="Start a new conversation"
                  onClick={restartConversation}
                  disabled={sending}
                  className="icon-btn"
                  style={{ width: 30, height: 30, opacity: sending ? 0.5 : 1 }}
                >
                  <IconRefresh width={15} height={15} />
                </button>
              )}
              <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="icon-btn" style={{ width: 30, height: 30 }}>
                ×
              </button>
            </div>
          </div>

          <div ref={scrollRef} style={styles.messages}>
            {messages.length === 0 && (
              <div style={styles.emptyWrap}>
                <div style={styles.empty}>
                  Hey! I'm here to help with your world, powered by IBM Granite. Ask me about your story, or how
                  to find your way around the app. A few ideas to get started:
                </div>
                <div style={styles.suggestions}>
                  {suggestions.map((s) => (
                    <button key={s} type="button" style={styles.suggestionChip} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => {
              const isStreamingPlaceholder = sending && i === messages.length - 1 && m.role === "assistant" && !m.content;
              return (
                <div key={i} style={m.role === "user" ? styles.bubbleUserRow : styles.bubbleAssistantRow}>
                  <div style={m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}>
                    {isStreamingPlaceholder ? (
                      <span className="pulse-dot" style={{ display: "inline-block" }} />
                    ) : (
                      m.content
                    )}
                    {m.offline && <span className="badge-offline" style={{ marginLeft: 8 }}>offline</span>}
                  </div>
                </div>
              );
            })}
            {followups.length > 0 && (
              <div style={styles.followupsWrap}>
                {followups.map((s) => (
                  <button key={s} type="button" style={styles.suggestionChip} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div style={styles.error}>
              <div>{error}</div>
              {retryText && (
                <button type="button" onClick={retry} style={styles.retryLink}>
                  Retry
                </button>
              )}
            </div>
          )}

          <div style={styles.inputRow}>
            <textarea
              ref={inputRef}
              className="field"
              style={styles.textarea}
              placeholder="Type your question…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => send()} disabled={sending || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const styles = {
  launcher: {
    position: "fixed",
    right: 20,
    bottom: 20,
    width: 52,
    height: 52,
    borderRadius: "50%",
    border: "none",
    background: "var(--accent)",
    color: "var(--on-accent)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: "var(--shadow-lg)",
    fontSize: 26,
    lineHeight: 1,
    zIndex: 999,
  },
  panel: {
    position: "fixed",
    right: 20,
    bottom: 84,
    width: 380,
    maxWidth: "calc(100vw - 40px)",
    height: 540,
    maxHeight: "calc(100vh - 120px)",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-lg)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    zIndex: 999,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px",
    borderBottom: "1px solid var(--border-soft)",
  },
  headerTitle: { fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, color: "var(--text)" },
  headerSubtitle: { fontSize: 11, color: "var(--text-faint)", marginTop: 2 },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  emptyWrap: { display: "flex", flexDirection: "column", gap: 12 },
  empty: { fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5 },
  suggestions: { display: "flex", flexDirection: "column", gap: 6 },
  followupsWrap: { display: "flex", flexDirection: "column", gap: 6, marginTop: 2, alignItems: "flex-start" },
  suggestionChip: {
    textAlign: "left",
    background: "var(--surface-hover)",
    border: "1px solid var(--border-soft)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text)",
    fontSize: 13,
    lineHeight: 1.4,
    padding: "8px 12px",
    cursor: "pointer",
  },
  bubbleUserRow: { display: "flex", justifyContent: "flex-end" },
  bubbleAssistantRow: { display: "flex", justifyContent: "flex-start" },
  bubbleUser: {
    maxWidth: "82%",
    background: "var(--accent)",
    color: "var(--on-accent)",
    padding: "9px 13px",
    borderRadius: "14px 14px 4px 14px",
    fontSize: 14,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
  },
  bubbleAssistant: {
    maxWidth: "82%",
    background: "var(--surface-hover)",
    color: "var(--text)",
    padding: "9px 13px",
    borderRadius: "14px 14px 14px 4px",
    fontSize: 14,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
  },
  error: {
    margin: "0 16px 10px",
    padding: "8px 10px",
    fontSize: 12.5,
    color: "var(--danger)",
    background: "var(--danger-soft)",
    border: "1px solid var(--danger)",
    borderRadius: "var(--radius-sm)",
    lineHeight: 1.45,
  },
  retryLink: {
    marginTop: 6,
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--danger)",
    fontWeight: 600,
    fontSize: 12.5,
    textDecoration: "underline",
    cursor: "pointer",
  },
  inputRow: {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid var(--border-soft)",
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    resize: "none",
    minHeight: 42,
    maxHeight: 100,
    padding: "10px 12px",
    fontSize: 14,
  },
};
