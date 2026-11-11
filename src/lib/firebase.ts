import { appEnvironment } from "./environment.ts";
import { deleteApp, getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { clearIndexedDbPersistence, connectFirestoreEmulator, getFirestore, initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, terminate } from "firebase/firestore";

export const appMode = appEnvironment.mode;
export const isDemo = appMode === "demo";
/** Persistent cache is an internal optimization, not a user preference.
 * Firestore falls back to volatile memory in browsers without persistence.
 */
export function persistentCacheEnabled(): boolean {
  return typeof window !== "undefined";
}
/** Must run before navigating to a different account while persistent storage is active. */
export async function purgePrivateCache(): Promise<void> {
  if (!persistentCacheEnabled()) return;
  const {app,db} = firebaseServices();
  // Invalidate manifests first: another tab may prevent IndexedDB deletion,
  // but no old snapshot can be reused without a fresh server revision.
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("roteiva-cache-v2:") || key === "roteiva-private-cache")
        localStorage.removeItem(key);
    }
  } catch { /* Inaccessible storage cannot supply a reusable manifest. */ }
  await terminate(db);
  try {
    await clearIndexedDbPersistence(db);
  } finally {
    await deleteApp(app);
  }
}
export const useEmulators = appEnvironment.useEmulators;
export function firebaseServices() {
  if (appMode !== "demo" && appMode !== "firebase") throw new Error("Defina VITE_APP_MODE como demo ou firebase.");
  if (isDemo) throw new Error("Firebase não está disponível no modo demonstração.");
  const config = appEnvironment.firebase!;
  const existing = getApps().length > 0;
  const app = existing ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  const db = existing ? getFirestore(app) : initializeFirestore(app, {
    localCache: persistentCacheEnabled()
      ? persistentLocalCache({tabManager: persistentMultipleTabManager()})
      : memoryLocalCache(),
  });
  if (useEmulators && !existing) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return { app, auth, db };
}
