"""
Lightweight relevance-ranking retrieval layer — server-side port of
src/lib/retrieval.js.  Same algorithm: weighted term-overlap scoring,
recency tiebreaker, top-K.  Swappable behind the same get_relevant_canon()
signature if a vector store is added later.
"""

import re
from typing import Any

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "are", "was",
    "were", "be", "this", "that", "with", "for", "as", "it", "its", "at", "by",
    "from", "who", "what", "where", "when", "how", "does", "do", "did", "has",
    "have", "had", "will", "would", "can", "could", "into", "about", "your",
}


def _tokenize(text: str) -> list[str]:
    tokens = re.sub(r"[^a-z0-9\s]", " ", (text or "").lower()).split()
    return [w for w in tokens if len(w) > 2 and w not in STOPWORDS]


def _score_asset(query_tokens: list[str], asset: dict, index_from_end: int) -> float:
    title_tokens = _tokenize(asset.get("title", ""))
    body = " ".join([
        asset.get("content", ""),
        asset.get("faction", ""),
        asset.get("era", ""),
        asset.get("type", ""),
        asset.get("mood", ""),
    ])
    body_tokens = _tokenize(body)
    score: float = 0.0
    for qt in query_tokens:
        if qt in title_tokens:
            score += 3
        score += body_tokens.count(qt)
    # gentle recency tiebreaker
    score += max(0, 3 - index_from_end) * 0.15
    return score


def retrieve_relevant(assets: list[dict], query: str, k: int = 10) -> list[dict]:
    """Return the top-K assets most relevant to *query*.

    Falls back to the most-recent *k* entries when the query is empty or
    nothing scores above zero — matching the behaviour of the JS original.
    """
    if not assets:
        return []
    query_tokens = _tokenize(query)
    if not query_tokens:
        return assets[-k:]

    n = len(assets)
    scored = [
        (asset, _score_asset(query_tokens, asset, n - 1 - i))
        for i, asset in enumerate(assets)
    ]
    if not any(s > 0 for _, s in scored):
        return assets[-k:]

    scored.sort(key=lambda x: x[1], reverse=True)
    return [a for a, _ in scored[:k]]


def canon_block(assets: list[dict], query: str, limit: int = 10) -> str:
    relevant = retrieve_relevant(assets, query, limit)
    lines = [
        f"[{a['type']} | {a['era']} | {a['faction']}] {a['title']}: {a['content'][:220]}"
        for a in relevant
    ]
    return "\n".join(lines)
