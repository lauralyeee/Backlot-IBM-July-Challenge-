/* ============================================================
   Small, deliberately narrow text-to-block parsers for the Export screen's
   "document editor" preview. These are NOT general Markdown/Fountain
   engines -- they only need to round-trip the specific subset
   backend/export.py itself ever emits (see that file's own parser
   docstrings for the same caveat on the Python side, which these mirror).
   ============================================================ */

// ---- Markdown (characters / locations / beats / pitch) --------------------

// Matches any run of 1-6 leading '#' characters. The backend only ever asks
// Granite for "#" / "##", but it sometimes emits a deeper "### " sub-heading
// anyway -- without this, those lines fell into the plain-paragraph branch
// and the literal "###" showed up as visible text in the preview. Treating
// any heading depth as a real heading (capped visually at h3) means that
// can never leak through again, no matter what the model does.
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

export function parseMarkdownBlocks(text) {
  const lines = (text || "").split("\n");
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ type: "p", text: para.join(" ").trim() });
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = line.match(HEADING_RE);
    if (heading) {
      flush();
      const depth = heading[1].length;
      const kind = depth === 1 ? "h1" : depth === 2 ? "h2" : "h3";
      blocks.push({ type: kind, text: heading[2].trim() });
    }
    else if (line.startsWith("> ")) { flush(); blocks.push({ type: "quote", text: line.slice(2) }); }
    else if (line.startsWith("- ")) { flush(); blocks.push({ type: "li", text: line.slice(2) }); }
    else para.push(line);
  }
  flush();
  return blocks;
}

// Splits "some **bold** text" into plain/bold run tokens for rendering.
export function inlineRuns(text) {
  const parts = (text || "").split(/(\*\*.+?\*\*)/g).filter((p) => p !== "");
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? { bold: true, text: part.slice(2, -2), key: i }
      : { bold: false, text: part, key: i }
  );
}

// ---- Fountain (script / sample scene) --------------------------------------

const TITLE_KEYS = new Set(["title", "credit", "author", "authors", "draft date", "source", "contact"]);

function isCueLine(s) {
  return !!s && s === s.toUpperCase() && /[A-Z]/.test(s) && s.length < 40;
}

export function parseFountain(text) {
  const lines = (text || "").split("\n").map((l) => l.replace(/\s+$/, ""));
  let i = 0;
  const n = lines.length;
  const titlePage = {};

  while (i < n) {
    const line = lines[i].trim();
    if (!line) { i += 1; break; }
    const m = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (m && TITLE_KEYS.has(m[1].trim().toLowerCase())) {
      titlePage[m[1].trim().toLowerCase()] = m[2].trim();
      i += 1;
    } else break;
  }

  const blocks = [];
  while (i < n) {
    const line = lines[i].trim();
    if (!line) { i += 1; continue; }
    const upper = line.toUpperCase();

    if (/^(INT|EXT|EST|I\/E)[./\s]/.test(upper) || upper.startsWith("INT/EXT")) {
      blocks.push({ type: "heading", text: upper });
      i += 1;
    } else if (isCueLine(line) && upper.replace(/:$/, "").endsWith("TO")) {
      blocks.push({ type: "transition", text: upper });
      i += 1;
    } else if (isCueLine(line) && i + 1 < n && lines[i + 1].trim() !== "") {
      const name = upper.replace(/:$/, "");
      i += 1;
      let paren = "";
      if (i < n && lines[i].trim().startsWith("(") && lines[i].trim().endsWith(")")) {
        paren = lines[i].trim();
        i += 1;
      }
      const dialogue = [];
      while (i < n && lines[i].trim() && !isCueLine(lines[i].trim())) {
        dialogue.push(lines[i].trim());
        i += 1;
      }
      blocks.push({ type: "dialogue", character: name, parenthetical: paren, text: dialogue.join(" ").trim() });
    } else {
      const action = [line];
      i += 1;
      while (i < n && lines[i].trim() && !isCueLine(lines[i].trim())) {
        action.push(lines[i].trim());
        i += 1;
      }
      blocks.push({ type: "action", text: action.join(" ").trim() });
    }
  }
  return { titlePage, blocks };
}
