/* ============================================================
   Lightweight local retrieval layer.
   This approximates what the proposal's vector-store + LangChain
   RAG pipeline would do (retrieve the most RELEVANT canon before
   generating), without a real embedding model: it scores every
   canon entry against the query by weighted term overlap and
   returns the top-K, instead of just the most recently added
   entries. Swappable later for a real embedding/vector-store
   retriever behind the same getRelevantCanon() signature.
   ============================================================ */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "are", "was",
  "were", "be", "this", "that", "with", "for", "as", "it", "its", "at", "by",
  "from", "who", "what", "where", "when", "how", "does", "do", "did", "has",
  "have", "had", "will", "would", "can", "could", "into", "about", "your",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function scoreAsset(queryTokens, asset, indexFromEnd) {
  const titleTokens = tokenize(asset.title);
  const bodyTokens = tokenize(`${asset.content} ${asset.faction} ${asset.era} ${asset.type} ${asset.mood}`);
  let score = 0;
  for (const qt of queryTokens) {
    if (titleTokens.includes(qt)) score += 3;
    score += bodyTokens.filter((t) => t === qt).length;
  }
  // gentle recency tiebreaker so newer canon edges out older canon of equal relevance
  score += Math.max(0, 3 - indexFromEnd) * 0.15;
  return score;
}

/** Returns the top-K assets most relevant to `query`, falling back to
 *  most-recent when the query is empty or nothing scores above zero. */
export function retrieveRelevant(assets, query, k = 10) {
  if (!assets.length) return [];
  const queryTokens = tokenize(query);

  if (!queryTokens.length) {
    return assets.slice(-k);
  }

  const scored = assets.map((a, i) => ({
    a,
    score: scoreAsset(queryTokens, a, assets.length - 1 - i),
  }));

  const anyMatch = scored.some((s) => s.score > 0);
  if (!anyMatch) return assets.slice(-k);

  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((s) => s.a);
}

export function canonBlock(assets, query, limit = 10) {
  const relevant = retrieveRelevant(assets, query, limit);
  return relevant
    .map((a) => `[${a.type} | ${a.era} | ${a.faction}] ${a.title}: ${a.content.slice(0, 220)}`)
    .join("\n");
}
