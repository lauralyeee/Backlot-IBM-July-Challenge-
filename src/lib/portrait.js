/* ============================================================
   NPC portrait module.
   Builds deterministic Pollinations.ai image URLs from the
   portrait prompt + seed stored on a character asset (drafted
   by Granite via POST .../portrait). Same prompt + seed always
   renders the same face, and each expression is that same
   prompt with a short modifier appended — so expressions stay
   recognisably the same person with zero image storage on our
   side.

   IMPORTANT: always use the same width/height everywhere — the
   size is part of Pollinations' generation key, so a different
   size means a *different image*, not a resize. Render small
   avatars by scaling the same 512px URL down in CSS.

   Free anonymous tier is rate-limited (~1 request / 15 s), so
   expression variants are cache-warmed with a stagger — see
   preloadExpressions().
   ============================================================ */

export const EXPRESSIONS = ["neutral", "amused", "angry", "wary", "sad"];

const EXPRESSION_MODIFIERS = {
  neutral: "calm neutral expression",
  amused: "warm, subtly amused smile",
  angry: "furious glare, tense jaw",
  wary: "wary narrowed eyes, guarded expression",
  sad: "sorrowful, downcast expression",
};

const STYLE_TAIL =
  "character portrait, head and shoulders, centered, painterly digital illustration, dramatic lighting, detailed face";

const SIZE = 512; // the one canonical size — see note above

// Optional registered Pollinations token (get one free at
// enter.pollinations.ai) — lifts the anonymous rate limit and removes the
// watermark. Set it as VITE_POLLINATIONS_TOKEN in the project-root .env.
// This token is DESIGNED to be public/client-side, so a VITE_ var is fine
// here — but only this token; never put watsonx credentials in VITE_ vars.
const TOKEN = import.meta.env?.VITE_POLLINATIONS_TOKEN || "";

export function hasPortrait(asset) {
  return Boolean(asset?.portraitPrompt && asset?.portraitSeed != null);
}

export function portraitUrl(asset, expression = "neutral") {
  if (!hasPortrait(asset)) return null;
  const mod = EXPRESSION_MODIFIERS[expression] || EXPRESSION_MODIFIERS.neutral;
  const prompt = `${asset.portraitPrompt}, ${mod}, ${STYLE_TAIL}`;
  const params = new URLSearchParams({
    width: String(SIZE),
    height: String(SIZE),
    seed: String(asset.portraitSeed),
    nologo: "true",
    model: "flux",
  });
  if (TOKEN) params.set("token", TOKEN);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
}

/** Warm the browser + Pollinations cache for the non-neutral expression
 *  variants, one request every ~16 s to stay inside the anonymous-tier
 *  rate limit. Returns a cleanup function that cancels pending timers
 *  (wire it as a useEffect return value). */
export function preloadExpressions(asset) {
  if (!hasPortrait(asset)) return () => {};
  const timers = EXPRESSIONS.slice(1).map((expr, i) =>
    setTimeout(() => {
      const img = new Image();
      img.src = portraitUrl(asset, expr);
    }, (i + 1) * 16000)
  );
  return () => timers.forEach(clearTimeout);
}
