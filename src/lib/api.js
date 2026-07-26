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

// ── Generation ─────────────────────────────────────────────────────────────

/**
 * @param {string} worldId
 * @param {"expand"|"character"|"era_shift"} mode
 * @param {object} opts  { fragment, era, subjectId, forceType }
 * @returns {{ asset, grounding, offline?, error? }}
 */
export const generateAsset = (worldId, mode, opts = {}) =>
  req("POST", `/worlds/${worldId}/generate`, {
    mode,
    fragment: opts.fragment || "",
    era: opts.era || "",
    subject_id: opts.subjectId || null,
    force_type: opts.forceType || null,
  });

// ── Custom persona generation ──────────────────────────────────────────────

/**
 * @param {string} description  Free-text world description from the user
 * @returns {{ personaLabel, eras, nameIdeas, seed, offline? }}
 */
export const generateCustomPersona = (description) =>
  req("POST", "/personas/custom", { description });


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
