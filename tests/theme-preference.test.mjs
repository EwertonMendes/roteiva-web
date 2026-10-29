import {test} from "node:test";
import assert from "node:assert/strict";
import {isTheme, readStoredTheme, resolveTheme, themeStorageKey, writeStoredTheme} from "../src/lib/theme-preference.ts";

function browserStorage() {
  const entries = new Map();
  return {
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key,value) { entries.set(key,value); },
  };
}

test("theme keys isolate authenticated accounts from each other and from the demo", () => {
  assert.equal(themeStorageKey(), "roteiva-theme");
  assert.notEqual(themeStorageKey("user-a"), themeStorageKey("user-b"));
  assert.notEqual(themeStorageKey("user-a"), themeStorageKey());
});

test("browser mirror keeps the latest explicit theme across navigation and reload", () => {
  const storage = browserStorage(), key = themeStorageKey("user-a");
  writeStoredTheme(key, "dark", storage);
  assert.equal(readStoredTheme(key, storage), "dark");
  writeStoredTheme(key, "light", storage);
  assert.equal(readStoredTheme(key, storage), "light");
  assert.equal(readStoredTheme(themeStorageKey("user-b"), storage), undefined);
});

test("cloud preference takes precedence on hydration; local is a fallback", () => {
  assert.equal(resolveTheme("light", "dark", "dark"), "light");
  assert.equal(resolveTheme("dark", "light", "light"), "dark");
  assert.equal(resolveTheme(undefined, "dark", "light"), "dark");
  assert.equal(resolveTheme(null, undefined, "dark"), "dark");
  assert.equal(resolveTheme("unexpected", null, "light"), "light");
  assert.equal(isTheme(null), false);
});

test("invalid or denied storage is safely ignored", () => {
  const denied = {getItem(){throw Error("SecurityError");},setItem(){throw Error("SecurityError");}};
  assert.doesNotThrow(()=>writeStoredTheme("key", "dark", denied));
  assert.equal(readStoredTheme("key", denied), undefined);
  assert.equal(readStoredTheme("key", {getItem(){return "garbage";}}), undefined);
});
