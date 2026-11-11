import { environment } from '../../shared/environments.ts';

export function parseEnvironment(values: Record<string, string | boolean | undefined>, buildMode?: string) {
  const mode = values.VITE_APP_MODE;
  const appEnv = values.VITE_APP_ENV;
  if (mode !== 'demo' && mode !== 'firebase') throw new Error('VITE_APP_MODE must be demo or firebase');
  if (mode === 'demo') {
    if (appEnv !== 'demo' || (buildMode && !['demo', 'development'].includes(buildMode)))
      throw new Error('Demo requires an explicit demo build');
    return { mode, appEnv, useEmulators: false, apiBaseUrl: '', firebase: undefined } as const;
  }
  if (!['true', 'false'].includes(String(values.VITE_USE_EMULATORS))) throw new Error('VITE_USE_EMULATORS is required');
  const useEmulators = values.VITE_USE_EMULATORS === 'true';
  const firebase = {
    apiKey: String(values.VITE_FIREBASE_API_KEY || ''),
    authDomain: String(values.VITE_FIREBASE_AUTH_DOMAIN || ''),
    projectId: String(values.VITE_FIREBASE_PROJECT_ID || ''),
    appId: String(values.VITE_FIREBASE_APP_ID || ''),
    messagingSenderId: String(values.VITE_FIREBASE_MESSAGING_SENDER_ID || ''),
    storageBucket: String(values.VITE_FIREBASE_STORAGE_BUCKET || ''),
  };
  for (const [key, value] of Object.entries(firebase)) {
    if (key !== 'storageBucket' && (!value || /REPLACE|PLACEHOLDER/.test(value))) throw new Error('Missing Firebase config: ' + key);
  }
  if (useEmulators) {
    if (appEnv !== 'emulator' || firebase.projectId !== 'demo-roteiva' ||
        firebase.authDomain !== 'demo-roteiva.firebaseapp.com' || (buildMode && buildMode !== 'emulator') || values.VITE_API_BASE_URL)
      throw new Error('Emulators must remain isolated from remote services');
    return {mode, appEnv, useEmulators, apiBaseUrl: 'http://127.0.0.1:8787', firebase} as const;
  }
  const contract = environment(appEnv);
  if (buildMode && buildMode !== (appEnv === 'dev' ? 'firebase' : 'production')) throw new Error('Build mode and environment disagree');
  if (firebase.projectId !== contract.projectId || firebase.authDomain !== contract.projectId + '.firebaseapp.com' ||
      values.VITE_API_BASE_URL !== contract.apiOrigin ||
      (firebase.storageBucket && firebase.storageBucket !== contract.projectId + '.firebasestorage.app'))
    throw new Error('Cross-environment Firebase/API configuration rejected');
  if (!/^1:\d+:web:[\w-]+$/.test(firebase.appId) || !/^\d+$/.test(firebase.messagingSenderId) ||
      firebase.appId.split(':')[1] !== firebase.messagingSenderId) throw new Error('Invalid Firebase application identity');
  return {mode, appEnv, useEmulators, apiBaseUrl: contract.apiOrigin, firebase} as const;
}
