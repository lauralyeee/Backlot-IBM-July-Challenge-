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

// ── Ingestion (Feature 1: script/doc → auto-breakdown) ──────────────────────

/**
 * Read-only: extracts and diffs, but writes nothing. Approve entries with
 * commitIngested() below to actually add them to the World Book.
 * @param {string} worldId
 * @param {{text: string, title?: string}} doc
 * @returns {{ document, proposed, matches, timelineMarkers, relationships, offline? }}
 */
export const ingestText = (worldId, doc) =>
  req("POST", `/worlds/${worldId}/ingest`, { text: doc.text, title: doc.title || "Untitled document" });

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

// ── Diagnostics ────────────────────────────────────────────────────────────

export const pingBackend = () => req("GET", "/ping");
export const listModels = () => req("GET", "/models");
