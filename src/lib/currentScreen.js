/**
 * Tiny cross-tree store for "which screen is the user currently looking at."
 *
 * AssistantChat.jsx is mounted as a sibling of App (see src/main.jsx), not a
 * child of it, so it has no direct access to App's `tab` state. Rather than
 * lift all of App's tab/world/loading state up a level — a much bigger,
 * riskier diff for an unrelated component — App just reports its current
 * screen here whenever it changes (one useEffect), and AssistantChat
 * subscribes via useSyncExternalStore.
 *
 * Screen ids match Sidebar.jsx's nav ids ("home", "canon", "gallery",
 * "create", "characters", "timeline", "import", "export", "settings"),
 * plus two pseudo-ids App.jsx reports before a world exists: "loading" and
 * "onboarding".
 */

let current = "loading";
const listeners = new Set();

export function setCurrentScreen(id) {
  if (id === current) return;
  current = id;
  listeners.forEach((l) => l());
}

export function getCurrentScreen() {
  return current;
}

export function subscribeCurrentScreen(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
