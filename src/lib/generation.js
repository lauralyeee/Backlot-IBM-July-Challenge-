import { TYPES } from "./worldData";

export function personaSystem(world) {
  const roles = world.rolesFull;
  const voices = roles.map((r) => r.voice).join("; and ");
  const roleNames = roles.map((r) => r.label.toLowerCase()).join(" and ");
  const premise = premiseBlock(world);
  return `You are the resident ${world.personaLabel} of the world "${world.name}". Your audience is a ${roleNames}, so blend these needs: ${voices}. You are the guardian of canon: everything you produce must stay consistent with the established canon provided and must never contradict it. Match the tone, genre, and level of realism of this specific world -- do not default to fantasy, science-fiction, or mythic tropes unless this world's own persona and established canon actually call for them. Write original material in clear, accessible language.${premise ? " " + premise : ""}`;
}

export function premiseBlock(world) {
  const desc = (world.description || "").trim();
  if (!desc) return "";
  return `WORLD PREMISE: ${desc}`;
}

export const schemaFor = (world, titleStyle) => {
  const titleKey = titleStyle === "character"
    ? `"title" (the character's name -- a plausible name this world's people would actually go by: a first name, full name, nickname, or an in-world epithet used the way a *name* is used, never an abstract poetic phrase that reads like a chapter or event title)`
    : `"title" (a concise, fitting name or heading for this entry)`;
  return (
    `Output must be a single JSON object and nothing else — no explanation, no markdown. ` +
    `Keys: ${titleKey}, "type" (${TYPES.join("|")} -- pick "other" when the entry is a kind of ` +
    `thing this world clearly has (a faction, clan, guild, organization, deity, etc.) that isn't ` +
    `lore/character/location/event), "typeLabel" (ONLY when type is "other": a short 1-3 word name ` +
    `for what kind of thing this is, in this world's own vocabulary, e.g. "Faction", "Clan", "Guild", ` +
    `"Deity" -- otherwise ""), "era" (${world.eras.join("|")}), ` +
    `"faction" (an established faction or "—"), "mood" (one lowercase word), "content" (60-140 words). ` +
    `Begin your response with { and end with }.`
  );
};

export function normalizeAsset(raw, world, fallbackType) {
  const first = (v, d) => (typeof v === "string" && v.trim() ? v.trim() : d);
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    title: first(raw.title, "Untitled entry"),
    type: TYPES.includes(raw.type) ? raw.type : fallbackType || "lore",
    typeLabel: first(raw.typeLabel, ""),
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

export function offlineAsset(idea, world, assets, forceType, forceTypeLabel) {
  const seed = idea.length + assets.length;
  const related = assets.length ? pick(assets, seed) : null;
  const title = idea.split(/[—.,]/)[0].trim().split(" ").slice(0, 5).join(" ").replace(/^./, (c) => c.toUpperCase());
  const openers = ["Established in the world's records as", "Known throughout these lands as", "Spoken of in the older accounts as"];
  const links = related ? ` Its history runs alongside ${related.title}, and the two are rarely discussed apart.` : "";

  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    title: title || "New entry",
    type: forceType || (/who|person|keeper|captain|king|queen|warden/i.test(idea) ? "character" : "location"),
    typeLabel: forceTypeLabel || "",
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
    if (seen.has(key)) {
      const other = seen.get(key);
      const issue = other.type === a.type
        ? "Two entries share the same name, which may confuse your canon."
        : `"${a.title}" is used by both a ${other.type} and a ${a.type} — easy to mix up when picking an entry elsewhere in the app.`;
      issues.push({ severity: "low", entries: [other.title, a.title], issue });
    }
    seen.set(key, a);
  });
  // "faction" used to be a dedicated type; now any "other"-typed entry can
  // stand in for it (a Faction/Clan/Guild/etc.), so this checks by title
  // match across all entries rather than one hardcoded type.
  const titles = new Set(assets.map((a) => a.title));
  const hasOrgEntries = assets.some((b) => b.type === "other");
  assets.forEach((a) => {
    if (a.faction !== "—" && !titles.has(a.faction) && hasOrgEntries) {
      issues.push({ severity: "low", entries: [a.title], issue: `Belongs to "${a.faction}", which has no entry of its own yet.` });
    }
  });
  return { issues, offline: true };
}
