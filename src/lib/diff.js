// Paragraph-level "redline" diff between two versions of a compiled export
// document (Markdown for characters/locations/beats/pitch, Fountain for
// script). Deliberately coarse-grained: a writer comparing two drafts cares
// about which whole bios/beats/scene-blocks were added, cut, or reworded —
// not a character-by-character diff. A classic LCS alignment over
// paragraphs gives exactly that: unchanged paragraphs pass through
// untouched, and anything that just moved position still matches instead of
// showing up as a spurious remove+add pair.

function splitParagraphs(text) {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * @param {string} oldText
 * @param {string} newText
 * @returns {Array<{type: "same"|"added"|"removed", text: string}>}
 */
export function diffParagraphs(oldText, newText) {
  const a = splitParagraphs(oldText);
  const b = splitParagraphs(newText);
  const n = a.length;
  const m = b.length;

  // Standard LCS table, built backwards so we can walk it forwards below.
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "removed", text: a[i] });
      i++;
    } else {
      out.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < n) { out.push({ type: "removed", text: a[i] }); i++; }
  while (j < m) { out.push({ type: "added", text: b[j] }); j++; }
  return out;
}

/**
 * Rollup counts for a compact badge like "2 added · 1 cut · 1 reworded".
 * An immediately-adjacent removed+added pair is counted as one "changed"
 * paragraph rather than as a separate add and remove — that's how a
 * rewritten bio or beat actually reads to the person comparing drafts.
 * @param {Array<{type: string, text: string}>} ops
 */
export function summarizeDiff(ops) {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type === "removed" && ops[k + 1]?.type === "added") {
      changed++;
      k++;
    } else if (ops[k].type === "added") {
      added++;
    } else if (ops[k].type === "removed") {
      removed++;
    }
  }
  return { added, removed, changed };
}
