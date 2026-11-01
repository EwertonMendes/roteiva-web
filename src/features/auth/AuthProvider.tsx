import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { browserLocalPersistence, GoogleAuthProvider, onAuthStateChanged, setPersistence, signInWithPopup, signOut, type User } from "firebase/auth";
import { firebaseServices, persistentCacheEnabled, purgePrivateCache } from "../../lib/firebase";
import { authErrorMessage } from "./errors";
import {clearStorageImageCache} from "../drive/storage-image-cache";

export type AuthIntent = "login" | "register";
type AuthState = { user: User | null; loading: boolean; busy: boolean; error: string; intent: AuthIntent; login: (intent?: AuthIntent) => Promise<void>; logout: () => Promise<void> };
const AuthContext = createContext<AuthState | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider ausente.");
  return value;
}
export function AuthProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState<AuthIntent>("login");
  useEffect(() => {
    const {auth} = firebaseServices();
    let active=true, unsubscribe=()=>{};
    let previousUid:string|null=null;
    setPersistence(auth,browserLocalPersistence).then(()=>{
      if (!active) return;
      unsubscribe=onAuthStateChanged(auth,next=>{
        if(previousUid&&previousUid!==next?.uid)void clearStorageImageCache();
        previousUid=next?.uid||null;
        setUser(next);setLoading(false);
      },reason=>{
        setUser(null);setError(authErrorMessage(reason));setLoading(false);
      });
    }).catch(reason=>{if(active){setError(authErrorMessage(reason));setLoading(false);}});
    return ()=>{active=false;unsubscribe();};
  }, []);
  async function login(nextIntent: AuthIntent = "login") {
    setIntent(nextIntent);
    setBusy(true); setError("");
    try {
      const {auth} = firebaseServices();
      // Persistent session is configured before the provider flow. No Drive scopes.
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({prompt: "select_account"});
      await signInWithPopup(auth, provider);
    } catch (reason) { setError(authErrorMessage(reason)); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try {
      await signOut(firebaseServices().auth);
      await clearStorageImageCache();
      setUser(null);setIntent("login");
      if (persistentCacheEnabled()) {
        await purgePrivateCache();
        window.location.replace("/");
      }
    }
    catch (reason) { setError("Sessão encerrada, mas não foi possível limpar o cache local. Feche outras abas do Roteiva e limpe os dados deste site antes de entrar com outra conta."); }
    finally { setBusy(false); }
  }
  return <AuthContext.Provider value={{user, loading, busy, error, intent, login, logout}}>{children}</AuthContext.Provider>;
}
