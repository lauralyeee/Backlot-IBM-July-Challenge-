const KEY = "worldbuilding-copilot:poc:v1";

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let saveTimer = null;
export function saveState(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full or unavailable — fail silently, app still works in-memory */
    }
  }, 250);
}

export function clearState() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
