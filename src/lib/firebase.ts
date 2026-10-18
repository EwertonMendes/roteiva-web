import { deleteApp, getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { clearIndexedDbPersistence, connectFirestoreEmulator, getFirestore, initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, terminate } from "firebase/firestore";

export const appMode = import.meta.env.VITE_APP_MODE;
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
export const useEmulators = import.meta.env.VITE_USE_EMULATORS === "true";
export function firebaseServices() {
  if (appMode !== "demo" && appMode !== "firebase") throw new Error("Defina VITE_APP_MODE como demo ou firebase.");
  if (isDemo) throw new Error("Firebase não está disponível no modo demonstração.");
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  };
  const missing = Object.entries(config).filter(([key, value]) => key !== "storageBucket" && !value).map(([key]) => key);
  if (missing.length) throw new Error("Configuração Firebase ausente: " + missing.join(", ") + ". Confira as variáveis VITE_FIREBASE_*.");
  if (useEmulators ? config.projectId !== "demo-roteiva" : config.projectId !== "roteiva-web-dev") {
    throw new Error("Build restrito ao projeto roteiva-web-dev; emuladores exigem demo-roteiva.");
  }
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
