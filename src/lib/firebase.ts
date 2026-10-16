import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

export const appMode = import.meta.env.VITE_APP_MODE;
export const isDemo = appMode === "demo";
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
  const db = getFirestore(app);
  if (useEmulators && !existing) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return { app, auth, db };
}
