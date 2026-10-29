/** Browser mirror of the UI preference; Firestore remains the cross-device source of truth. */
export type Theme = "light" | "dark";
export type ThemePreference = {theme: Theme; changedAt: number};

export const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

/** Keep authenticated preferences isolated by Firebase UID; the demo has its own key. */
export function themeStorageKey(uid?: string): string {
  return uid ? `roteiva-theme:${uid}` : "roteiva-theme";
}

export function parseThemePreference(value: string | null): ThemePreference | undefined {
  if (isTheme(value)) return {theme:value,changedAt:0}; // Legacy demo/browser value.
  if (!value) return undefined;
  try {
    const parsed:unknown=JSON.parse(value);
    if (!parsed || typeof parsed!=="object") return undefined;
    const {theme,changedAt}=parsed as Partial<ThemePreference>;
    return isTheme(theme) && typeof changedAt==="number" && Number.isFinite(changedAt) && changedAt>=0
      ? {theme,changedAt} : undefined;
  } catch {return undefined;}
}

export function readStoredPreference(key: string, storage?: Pick<Storage, "getItem">): ThemePreference | undefined {
  try {return parseThemePreference((storage ?? window.localStorage).getItem(key));}
  catch {return undefined;} // Storage can be blocked without blocking the workspace.
}

export function writeStoredPreference(key: string, preference: ThemePreference, storage?: Pick<Storage, "setItem">): void {
  try {(storage ?? window.localStorage).setItem(key,JSON.stringify(preference));}
  catch {/* Keep the selected theme usable in memory even if storage is denied. */}
}

export function readStoredTheme(key: string, storage?: Pick<Storage, "getItem">): Theme | undefined {
  return readStoredPreference(key,storage)?.theme;
}

/** Demo storage remains compatible with existing browser-only preferences. */
export function writeStoredTheme(key: string, theme: Theme, storage?: Pick<Storage, "setItem">): void {
  try {(storage ?? window.localStorage).setItem(key,theme);}
  catch {/* Keep the selected theme usable in memory even if storage is denied. */}
}

/** Compare confirmed cloud/server time against the last explicit browser selection.
 * This prevents an older server read in a second tab from undoing a still-pending write. */
export function chooseThemePreference(
  cloud: ThemePreference | undefined,
  local: ThemePreference | undefined,
  system: Theme
): ThemePreference {
  if(cloud && (!local || cloud.changedAt>=local.changedAt)) return cloud;
  return local ?? {theme:system,changedAt:0};
}

export function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark" : "light";
}
