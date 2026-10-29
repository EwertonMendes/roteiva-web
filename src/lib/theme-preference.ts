/** Browser mirror of the UI preference; Firestore remains the cross-device source of truth. */
export type Theme = "light" | "dark";

export const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

/** Keep authenticated preferences isolated by Firebase UID; the demo has its own key. */
export function themeStorageKey(uid?: string): string {
  return uid ? `roteiva-theme:${uid}` : "roteiva-theme";
}

export function readStoredTheme(key: string, storage?: Pick<Storage, "getItem">): Theme | undefined {
  try {
    const saved = (storage ?? window.localStorage).getItem(key);
    return isTheme(saved) ? saved : undefined;
  } catch {
    return undefined; // Storage can be blocked without blocking the workspace.
  }
}

export function writeStoredTheme(key: string, theme: Theme, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? window.localStorage).setItem(key, theme);
  } catch {
    // The in-memory preference remains usable even when storage is unavailable.
  }
}

/** Explicit user choice in the cloud wins on initial load; local is a fast/offline fallback. */
export function resolveTheme(cloud: unknown, local: unknown, system: Theme): Theme {
  return isTheme(cloud) ? cloud : isTheme(local) ? local : system;
}

export function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark" : "light";
}
