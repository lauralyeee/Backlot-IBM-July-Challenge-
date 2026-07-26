/* ============================================================
   watsonx.ai / Granite client
   Proxied through Vite: /iam -> IBM IAM, /wx -> watsonx.ai (eu-de)
   ============================================================ */

const WX_PROJECT_ID = import.meta.env.VITE_WATSONX_PROJECT_ID;
// "ibm/granite-3-8b-instruct" has been deprecated/removed from watsonx.ai's
// catalog (IBM periodically retires older Granite model IDs), which is why
// the app was surfacing "model not found" errors. granite-3-3-8b-instruct
// is the current supported small Granite instruct model as of this writing.
// If IBM retires another model in this list, use listAvailableModels()
// below (surfaced in Settings > Test connection) to find the current ID.
const MODEL_CHAIN = ["ibm/granite-4-h-small", "ibm/granite-3-3-8b-instruct"];
// NOTE (2026-07-26): this file is legacy/unused (see AGENTS.md) — the live
// backend (backend/watsonx.py) switched from /ml/v1/text/generation to
// /ml/v1/text/chat to fix leaked instruction text / runaway replies in
// character chat. This file was not ported to match; comment kept in sync
// per AGENTS.md's instruction, not the implementation.

let lastGoodModel = null;

async function getToken() {
  const res = await fetch("/iam/identity/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${import.meta.env.VITE_WATSONX_API_KEY}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("IAM token exchange failed");
  return data.access_token;
}

async function callModel(model, prompt) {
  const token = await getToken();
  const res = await fetch(`/wx/ml/v1/text/generation?version=2024-05-01`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    body: JSON.stringify({
      model_id: model,
      project_id: WX_PROJECT_ID,
      input: prompt,
      parameters: { decoding_method: "greedy", max_new_tokens: 1000, stop_sequences: [] },
    }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) {
    throw new Error(data?.errors?.[0]?.message || `status ${res.status}`);
  }
  const text = (data.results || []).map((r) => r.generated_text).join("\n");
  if (!text.trim()) throw new Error("empty response");
  return text;
}

export async function generate(system, user) {
  const prompt = `${system}\n\n---\n\n${user}`;
  const order = lastGoodModel
    ? [lastGoodModel, ...MODEL_CHAIN.filter((m) => m !== lastGoodModel)]
    : MODEL_CHAIN;
  let lastError;

  for (const model of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await callModel(model, prompt);
        lastGoodModel = model;
        return text;
      } catch (e) {
        lastError = e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }
  }

  // Last tier: retry the FIRST (most current/reliable) model in the chain
  // with a much shorter, unstructured prompt — not the last entry, which
  // may be an older fallback that's more likely to have been deprecated.
  try {
    const short = await callModel(MODEL_CHAIN[0], user.slice(0, 400));
    return short;
  } catch (e) {
    lastError = e;
  }

  throw new Error(`${lastError.message} — tried ${order.length} models`);
}

export async function pingService() {
  const errors = [];
  for (const model of MODEL_CHAIN) {
    try {
      const reply = await callModel(model, "Reply with the single word: ready");
      lastGoodModel = model;
      return { model, reply: reply.trim() };
    } catch (e) {
      errors.push(`${model}: ${e.message}`);
    }
  }
  // Every configured model failed — this is almost always a deprecated/
  // renamed model_id rather than a real outage. Look up what's actually
  // available on this project right now so the error is actionable instead
  // of a dead end.
  try {
    const live = await listAvailableModels();
    if (live.length) {
      throw new Error(
        `${errors.join(" · ")} — none of the configured models worked, but this project can currently reach: ${live.slice(0, 8).join(", ")}. Update MODEL_CHAIN in src/lib/watsonx.js to one of these.`
      );
    }
  } catch (e) {
    if (e.message.includes("MODEL_CHAIN")) throw e; // re-throw our own actionable error above
    // listAvailableModels itself failed (e.g. IAM/network down) — fall through to the plain error below.
  }
  throw new Error(errors.join(" · "));
}

/** Queries watsonx.ai for the foundation models this project can currently
 *  use for text generation. Used as a diagnostic when the configured
 *  MODEL_CHAIN stops working (IBM periodically deprecates model IDs). */
export async function listAvailableModels() {
  const token = await getToken();
  const res = await fetch(`/wx/ml/v1/foundation_model_specs?version=2024-05-01&filters=function_text_generation`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Could not list models (status ${res.status})`);
  return (data.resources || []).map((m) => m.model_id).filter(Boolean);
}

export function parseJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The reply wasn't in the expected format.");
  return JSON.parse(clean.slice(start, end + 1));
}
