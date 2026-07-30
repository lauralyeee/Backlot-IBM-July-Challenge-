/* ============================================================
   Backend API client — replaces direct localStorage + watsonx browser calls.
   All calls go to /api/* which is proxied to the FastAPI backend by Vite.
   The API key is held exclusively server-side.
   ============================================================ */

const BASE = "/api";

async function req(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── World ──────────────────────────────────────────────────────────────────

export const createWorld = (data) => req("POST", "/worlds", data);
export const getWorld = (id) => req("GET", `/worlds/${id}`);
export const patchWorld = (id, data) => req("PATCH", `/worlds/${id}`, data);

// ── Assets ─────────────────────────────────────────────────────────────────

export const listAssets = (worldId, type) =>
  req("GET", `/worlds/${worldId}/assets${type ? `?type=${type}` : ""}`);

export const saveAsset = (worldId, asset) =>
  req("POST", `/worlds/${worldId}/assets`, asset);

export const deleteAsset = (worldId, assetId) =>
  req("DELETE", `/worlds/${worldId}/assets/${assetId}`);

export const updateAsset = (worldId, assetId, data) =>
  req("PATCH", `/worlds/${worldId}/assets/${assetId}`, data);

/**
 * Draft (or re-draft — it also rolls a new seed, i.e. "repaint") the visual
 * portrait prompt for an asset via Granite, persisted on the asset row.
 * The actual image render happens client-side via src/lib/portrait.js.
 * @returns {{ asset, offline? }}
 */
export const generatePortrait = (worldId, assetId) =>
  req("POST", `/worlds/${worldId}/assets/${assetId}/portrait`);

// ── AI-cast character voice (Gemini TTS) ────────────────────────────────────

/**
 * Draft a voice description via Granite, then pick a matching fixed
 * Gemini TTS voice and get one preview clip. Nothing is saved yet —
 * call again for a fresh take (regenerate), or confirmCharacterVoice()
 * once the preview sounds right.
 * @param {string} worldId
 * @param {number} assetId
 * @param {string[]} [excludeVoiceIds]  voices already shown this casting
 *   session — passed back so regenerate doesn't repeat the same voice.
 * @returns {{ voiceDescription, voiceId, voiceName, audioBase64, offline? }}
 */
export const designCharacterVoice = (worldId, assetId, excludeVoiceIds = []) =>
  req("POST", `/worlds/${worldId}/assets/${assetId}/voice/design`, { excludeVoiceIds });

/**
 * Lock in a previewed library voice as this character's permanent voice —
 * every future reply for them reuses it from here on.
 * @returns {{ asset }}
 */
export const confirmCharacterVoice = (worldId, assetId, voiceId, voiceDescription) =>
  req("POST", `/worlds/${worldId}/assets/${assetId}/voice/confirm`, {
    voiceId,
    voiceDescription,
  });

/**
 * Synthesize `text` in a character's already-cast voice. Returns a
 * playable object URL, or throws if no voice is cast yet / the service is
 * unavailable — callers should catch and fall back to Web Speech (see
 * src/lib/voice.js speak()).
 * @param {string} worldId
 * @param {number} assetId
 * @param {string} text
 * @returns {Promise<string>} an object URL for an <audio> element
 */
export async function speakAsCharacter(worldId, assetId, text) {
  const res = await fetch(`${BASE}/worlds/${worldId}/assets/${assetId}/voice/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API POST voice/speak → ${res.status}: ${detail}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── Concept media: 3D model, image, or video (manual upload + Blender/CharMorph generation) ──

/**
 * Manual import: upload a pre-made 3D model (.glb/.gltf), a concept-art
 * image, or a short video as an asset's concept media. The backend
 * classifies which kind it is by file extension and returns it as
 * asset.modelKind ("3d" | "image" | "video").
 * @param {string} worldId
 * @param {number} assetId
 * @param {File} file
 * @returns {{ asset }}
 */
export async function uploadModel3D(worldId, assetId, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE}/worlds/${worldId}/assets/${assetId}/model3d/upload`, { method: "POST", body: formData });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST /worlds/${worldId}/assets/${assetId}/model3d/upload → ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Kick off Blender/CharMorph 3D concept generation for a character asset.
 * Returns immediately with the asset in model_status "pending" — poll
 * getModel3DStatus() until it flips to "ready" or "failed".
 * @param {string} worldId
 * @param {number} assetId
 * @returns {{ asset }}
 */
export const generateModel3D = (worldId, assetId) =>
  req("POST", `/worlds/${worldId}/assets/${assetId}/model3d/generate`);

/**
 * @param {string} worldId
 * @param {number} assetId
 * @returns {{ asset }}
 */
export const getModel3DStatus = (worldId, assetId) =>
  req("GET", `/worlds/${worldId}/assets/${assetId}/model3d/status`);

/**
 * Remove an asset's 3D concept model (deletes the file on disk and clears
 * the model_* fields). Use this instead of deleting the .glb by hand --
 * the app has no way to notice a file that disappeared outside of it.
 * @param {string} worldId
 * @param {number} assetId
 * @returns {{ asset }}
 */
export const deleteModel3D = (worldId, assetId) =>
  req("DELETE", `/worlds/${worldId}/assets/${assetId}/model3d`);

// ── Export (Feature 2: assets → Markdown document) ─────────────────────────

/**
 * Read-only: compiles a filtered set of canon assets into a Markdown document.
 * Named exportDocument (not "export") because `export` is a reserved word in
 * JS modules.
 * @param {string} worldId
 * @param {{ docType: string, era?: string, faction?: string }} opts
 * @returns {{ markdown, docType, assetCount, generatedAt?, empty?, offline? }}
 */
export const exportDocument = (worldId, { docType, era = "", faction = "" }) =>
  req("POST", `/worlds/${worldId}/export`, { docType, era, faction });

/**
 * Converts an already-compiled document (the `markdown` field returned by
 * exportDocument() above -- Markdown, or Fountain for docType "script")
 * into a real downloadable file (PDF/DOCX/Fountain/Markdown). Separate from
 * `req()` since that helper always expects a JSON response body; this one
 * expects a binary file and reads the filename off Content-Disposition.
 * Never re-runs generation -- purely a format conversion of text the
 * caller already has, so switching formats after a Generate is instant.
 * @param {string} worldId
 * @param {{ docType: string, format: "pdf"|"docx"|"fountain"|"markdown", content: string, assetCount?: number }} opts
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
/**
 * List past export versions ("history") for one document type, most-recent
 * first. Every successful exportDocument() call snapshots a version
 * server-side, so this is a read-only window onto prior compiles — feeds
 * Export.jsx's Version History panel.
 * @param {string} worldId
 * @param {string} docType
 * @returns {Promise<Array<{id, worldId, docType, era, faction, assetCount, content, offline, createdAt}>>}
 */
export const listExportHistory = (worldId, docType) =>
  req("GET", `/worlds/${worldId}/export/history?docType=${encodeURIComponent(docType)}`);

/**
 * Remove one snapshot from a document type's version history (e.g. an
 * experimental draft the writer doesn't want cluttering the list). Does not
 * touch canon or any downloaded file — purely prunes the history list.
 * @param {string} worldId
 * @param {string} versionId
 */
export const deleteExportVersion = (worldId, versionId) =>
  req("DELETE", `/worlds/${worldId}/export/history/${versionId}`);

export async function downloadExport(worldId, { docType, format, content, assetCount = 0 }) {
  const res = await fetch(`${BASE}/worlds/${worldId}/export/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docType, format, content, assetCount }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST /worlds/${worldId}/export/download → ${res.status}: ${text}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  return { blob, filename: match ? match[1] : `export.${format}` };
}

// ── Ingestion (Feature 1: script/doc → auto-breakdown) ──────────────────────

/**
 * Read-only: extracts and diffs, but writes nothing. Approve entries with
 * commitIngested() below to actually add them to the World Book. Timeline
 * markers now arrive as "event"-typed entries inside proposed/matches
 * (each match tagged with a confidence of "exact" or "likely") rather than
 * their own separate array. Long documents are chunked server-side —
 * chunkCount reports how many sections it took.
 * @param {string} worldId
 * @param {{text: string, title?: string}} doc
 * @returns {{ document, proposed, matches, relationships, chunkCount, offline? }}
 */
export const ingestText = (worldId, doc) =>
  req("POST", `/worlds/${worldId}/ingest`, { text: doc.text, title: doc.title || "Untitled document" });

/**
 * Docling companion to ingestText: same read-only staging, but the source
 * text comes from an uploaded PDF/DOCX/TXT/Fountain file instead of pasted
 * text. Uses FormData directly (not the shared req() helper, which always
 * JSON-encodes) so the browser sets the correct multipart boundary itself.
 * @param {string} worldId
 * @param {File} file
 * @param {string} [title]
 * @returns {{ document, proposed, matches, relationships, chunkCount, offline? }}
 */
export async function ingestFile(worldId, file, title) {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);
  const res = await fetch(`${BASE}/worlds/${worldId}/ingest/file`, { method: "POST", body: formData });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST /worlds/${worldId}/ingest/file → ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * @param {string} worldId
 * @param {object} document  the staged document object returned by ingestText
 * @param {Array}  assets    one or more approved entries to persist
 * @returns {{ created: Array }}
 */
export const commitIngested = (worldId, document, assets) =>
  req("POST", `/worlds/${worldId}/ingest/commit`, { document, assets });

/**
 * Overwrite an existing World Book asset with content from a matched extraction.
 * @param {string} worldId
 * @param {number} assetId   the id of the existing asset to overwrite
 * @param {object} document  the staged document object returned by ingestText
 * @param {object} item      the extracted item from staged.matches[n].extracted
 * @returns {{ updated: object }}
 */
export const updateIngestedAsset = (worldId, assetId, document, item) =>
  req("POST", `/worlds/${worldId}/ingest/update/${assetId}`, { document, item });

/**
 * List past imports for a world, most-recent-first. Feeds Import.jsx's
 * "Past imports" card (preview + re-extract).
 * @param {string} worldId
 * @returns {Array<{id, worldId, title, rawText, createdAt}>}
 */
export const listDocuments = (worldId) => req("GET", `/worlds/${worldId}/documents`);

/**
 * Persist writer-approved relationships extracted from a staged document.
 * @param {string} worldId
 * @param {object} document       the staged document object returned by ingestText
 * @param {Array<{id, a, b, context}>} relationships
 * @returns {{ created: Array }}
 */
export const commitRelationships = (worldId, document, relationships) =>
  req("POST", `/worlds/${worldId}/ingest/relationships/commit`, { document, relationships });

/**
 * List all persisted relationships for a world (used by Characters.jsx to
 * show a character's known relationships).
 * @param {string} worldId
 * @returns {Array<{id, worldId, a, b, context, sourceDocumentId, createdAt}>}
 */
export const listRelationships = (worldId) => req("GET", `/worlds/${worldId}/relationships`);

// ── Generation ─────────────────────────────────────────────────────────────

/**
 * @param {string} worldId
 * @param {"expand"|"character"|"era_shift"} mode
 * @param {object} opts  { fragment, era, subjectId, forceType, traits }
 *   traits (character mode only): optional { gender, age, appearance,
 *   personality } — provided keys become hard requirements; blank = AI invents.
 * @returns {{ asset, grounding, offline?, error? }}
 */
export const generateAsset = (worldId, mode, opts = {}) =>
  req("POST", `/worlds/${worldId}/generate`, {
    mode,
    fragment: opts.fragment || "",
    era: opts.era || "",
    subject_id: opts.subjectId || null,
    force_type: opts.forceType || null,
    traits: opts.traits || null,
  });

// ── Custom persona generation ──────────────────────────────────────────────

/**
 * @param {string} description  Free-text world description from the user
 * @param {string[]|null} [customEras]  Writer-specified era names, if any --
 *   these always win over whatever the model would invent.
 * @returns {{ personaLabel, eras, nameIdeas, seed, offline? }}
 */
export const generateCustomPersona = (description, customEras) =>
  req("POST", "/personas/custom", {
    description,
    ...(customEras && customEras.length ? { customEras } : {}),
  });

// ── Eras (Timeline / Time-Shift Mode) ───────────────────────────────────────

/**
 * Rename an era; the backend cascades the change to every asset tagged with
 * the old era name so a rename never silently orphans existing entries.
 * @returns {{ world, assetsUpdated }}
 */
export const renameEra = (worldId, oldEra, newEra) =>
  req("POST", `/worlds/${worldId}/eras/rename`, { oldEra, newEra });

/**
 * Remove an era. If entries still use it, pass mergeInto (one of the
 * world's other eras) to reassign them first -- otherwise the backend
 * responds with a 409 and a count so the caller can prompt for a target.
 * @returns {{ world, assetsReassigned }}
 */
export const removeEra = (worldId, era, mergeInto) =>
  req("POST", `/worlds/${worldId}/eras/remove`, {
    era,
    ...(mergeInto ? { mergeInto } : {}),
  });

/**
 * AI-draft 1-2 sentence descriptions for eras that lack one (or pass a
 * specific era name to re-draft just that one). Descriptions feed the
 * era-shift prompt and portrait briefs, so the model knows what each era
 * means instead of guessing from its name.
 * @returns {{ world, described: string[], offline? }}
 */
export const describeEras = (worldId, era) =>
  req("POST", `/worlds/${worldId}/eras/describe`, era ? { era } : {});


// ── Consistency audit ──────────────────────────────────────────────────────

export const auditWorld = (worldId) => req("POST", `/worlds/${worldId}/audit`, {});

// ── Ask / Q&A ──────────────────────────────────────────────────────────────

/**
 * @param {string} worldId
 * @param {"lore"|string} mode  "lore" or character asset id
 * @param {string} question
 * @param {Array}  history   [{role, text}, …]
 * @returns {{ reply, offline? }}
 */
export const ask = (worldId, mode, question, history = []) =>
  req("POST", `/worlds/${worldId}/ask`, { mode, question, history });

// ── Floating assistant widget ───────────────────────────────────────────────

/**
 * General-purpose (not world/canon-grounded) chat for the floating widget
 * (src/components/AssistantChat.jsx). Uses the same server-side IBM Granite
 * credentials and model fallback as every other AI feature in this app.
 *
 * Streams via SSE (backend/main.py's /api/widget-chat returns
 * text/event-stream) so the panel can render tokens as they arrive instead
 * of waiting for the full reply. `onDelta` is called with each text chunk
 * as it comes in; the promise resolves with the full concatenated reply
 * once the stream ends.
 *
 * A non-2xx response, a dropped connection, or any other transport-level
 * failure rejects the promise — that's the network case AssistantChat.jsx
 * auto-retries once before showing an error. A model-side failure (all
 * models in the fallback chain down) is NOT an exception here: the backend
 * already turns that into a friendly "temporarily unavailable" reply and
 * marks it `offline`, same as the rest of the app's AI features.
 *
 * @param {Array<{role: "user"|"assistant", content: string}>} messages
 * @param {string} [screen]  current app tab/screen id (see Sidebar.jsx nav
 *   ids), so the assistant can tailor answers to what's on screen
 * @param {(deltaText: string) => void} [onDelta]  called per streamed chunk
 * @returns {Promise<{ reply: string, offline?: boolean }>}
 */
export async function widgetChat(messages, screen, onDelta) {
  const res = await fetch(`${BASE}/widget-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...(screen ? { screen } : {}) }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`API POST /widget-chat → ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let offline = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? ""; // last entry may be an incomplete event — keep it for next read

    for (const raw of events) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      let evt;
      try {
        evt = JSON.parse(line.slice(5).trim());
      } catch {
        continue; // malformed chunk — skip rather than corrupt the reply
      }
      if (evt.delta) {
        reply += evt.delta;
        onDelta?.(evt.delta);
      }
      if (evt.offline) offline = true;
    }
  }

  return { reply, offline };
}

// ── Diagnostics ────────────────────────────────────────────────────────────

export const pingBackend = () => req("GET", "/ping");
export const listModels = () => req("GET", "/models");

/**
 * Which optional features this deployment supports — always all-true
 * locally, all-false on Vercel today (3D generation, manual media upload,
 * Docling PDF/DOCX parsing). Gallery.jsx and Import.jsx fetch this once on
 * load to grey out the affordances for whatever's disabled.
 * @returns {{ model3dGeneration: boolean, mediaUpload: boolean, doclingImport: boolean }}
 */
export const getCapabilities = () => req("GET", "/capabilities");
