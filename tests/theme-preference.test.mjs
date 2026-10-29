import {test} from "node:test";
import assert from "node:assert/strict";
import {
  chooseThemePreference, parseThemePreference, readStoredPreference,
  readStoredTheme, themeStorageKey, writeStoredPreference, writeStoredTheme,
} from "../src/lib/theme-preference.ts";

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

test("browser mirror persists the latest choice across routes and reloads", () => {
  const storage = browserStorage(), key = themeStorageKey("user-a");
  writeStoredPreference(key, {theme:"dark",changedAt:110}, storage);
  assert.deepEqual(readStoredPreference(key, storage), {theme:"dark",changedAt:110});
  writeStoredPreference(key, {theme:"light",changedAt:120}, storage);
  assert.equal(readStoredTheme(key, storage), "light");
  assert.equal(readStoredTheme(themeStorageKey("user-b"), storage), undefined);
});

test("an in-flight older cloud read cannot undo a newer tab choice", () => {
  const cloud = {theme:"light",changedAt:100};
  const newerLocal = {theme:"dark",changedAt:200};
  assert.deepEqual(chooseThemePreference(cloud,newerLocal,"light"),newerLocal);
  assert.deepEqual(chooseThemePreference({theme:"dark",changedAt:300},newerLocal,"light"),{theme:"dark",changedAt:300});
  assert.deepEqual(chooseThemePreference(undefined,newerLocal,"light"),newerLocal);
  assert.deepEqual(chooseThemePreference(undefined,undefined,"dark"),{theme:"dark",changedAt:0});
});

test("a newer cloud value wins on a later device refresh", () => {
  assert.equal(chooseThemePreference({theme:"light",changedAt:250},{theme:"dark",changedAt:200},"dark").theme,"light");
  assert.equal(chooseThemePreference({theme:"dark",changedAt:20},{theme:"light",changedAt:0},"light").theme,"dark");
});

test("legacy demo values work and malformed or denied storage is harmless", () => {
  const storage=browserStorage();
  writeStoredTheme(themeStorageKey(),"dark",storage);
  assert.equal(readStoredTheme(themeStorageKey(),storage),"dark");
  assert.deepEqual(parseThemePreference("light"),{theme:"light",changedAt:0});
  assert.equal(parseThemePreference('{"theme":"dark","changedAt":"not-a-time"}'),undefined);
  const denied = {getItem(){throw Error("SecurityError");},setItem(){throw Error("SecurityError");}};
  assert.doesNotThrow(()=>writeStoredPreference("key",{theme:"dark",changedAt:1},denied));
  assert.equal(readStoredPreference("key",denied),undefined);
});
