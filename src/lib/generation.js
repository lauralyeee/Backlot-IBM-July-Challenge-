import { TYPES } from "./worldData";

export function personaSystem(world) {
  const roles = world.rolesFull;
  const voices = roles.map((r) => r.voice).join("; and ");
  const roleNames = roles.map((r) => r.label.toLowerCase()).join(" and ");
  return `You are the resident ${world.personaLabel} of the world "${world.name}". Your audience is a ${roleNames}, so blend these needs: ${voices}. You are the guardian of canon: everything you produce must stay consistent with the established canon provided and must never contradict it. Write original material in clear, accessible language.`;
}

export const schemaFor = (world) =>
  `Output must be a single JSON object and nothing else — no explanation, no markdown. ` +
  `Keys: "title" (short evocative name), "type" (${TYPES.join("|")}), "era" (${world.eras.join("|")}), ` +
  `"faction" (an established faction or "—"), "mood" (one lowercase word), "content" (60-140 words). ` +
  `Begin your response with { and end with }.`;

export function normalizeAsset(raw, world, fallbackType) {
  const first = (v, d) => (typeof v === "string" && v.trim() ? v.trim() : d);
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    title: first(raw.title, "Untitled entry"),
    type: TYPES.includes(raw.type) ? raw.type : fallbackType || "lore",
    era: world.eras.includes(raw.era) ? raw.era : world.eras[0],
    faction: first(raw.faction, "—"),
    mood: first(raw.mood, "neutral"),
    content: first(raw.content, "No description was returned."),
    createdAt: Date.now(),
  };
}

/* ---------- offline fallback ----------
   Keeps the app usable end-to-end if watsonx is unreachable. Every
   offline entry is clearly flagged so it's never mistaken for
   real model output. */

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

export function offlineAsset(idea, world, assets, forceType) {
  const seed = idea.length + assets.length;
  const related = assets.length ? pick(assets, seed) : null;
  const title = idea.split(/[—.,]/)[0].trim().split(" ").slice(0, 5).join(" ").replace(/^./, (c) => c.toUpperCase());
  const openers = ["Established in the world's records as", "Known throughout these lands as", "Spoken of in the older accounts as"];
  const links = related ? ` Its history runs alongside ${related.title}, and the two are rarely discussed apart.` : "";

  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    title: title || "New entry",
    type: forceType || (/who|person|keeper|captain|king|queen|warden/i.test(idea) ? "character" : "location"),
    era: world.eras[Math.abs(seed) % world.eras.length],
    faction: related?.faction && related.faction !== "—" ? related.faction : "—",
    mood: "unsettled",
    content: `${pick(openers, seed)}: ${idea}.${links} Drafted offline — reopen when the service is back to have it expanded and checked against your canon.`,
    offline: true,
    createdAt: Date.now(),
  };
}

export function offlineAnswer(question, assets) {
  const words = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = assets
    .map((a) => ({ a, score: words.filter((w) => (a.title + " " + a.content).toLowerCase().includes(w)).length }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score);
  if (!scored.length) return "Nothing in your World Book covers that yet — which makes it a gap worth filling. (Answered offline, from your entries only.)";
  const top = scored.slice(0, 2).map((s) => `${s.a.title}: ${s.a.content}`).join("\n\n");
  return `From your World Book:\n\n${top}\n\n(Answered offline, by searching your entries.)`;
}

export function offlineAudit(assets) {
  const issues = [];
  const seen = new Map();
  assets.forEach((a) => {
    const key = a.title.toLowerCase();
    if (seen.has(key)) issues.push({ severity: "low", entries: [seen.get(key).title, a.title], issue: "Two entries share the same name, which may confuse your canon." });
    seen.set(key, a);
  });
  const factions = new Set(assets.filter((a) => a.type === "faction").map((a) => a.title));
  assets.forEach((a) => {
    if (a.faction !== "—" && !factions.has(a.faction) && assets.some((b) => b.type === "faction")) {
      issues.push({ severity: "low", entries: [a.title], issue: `Belongs to "${a.faction}", which has no entry of its own yet.` });
    }
  });
  return { issues, offline: true };
}
