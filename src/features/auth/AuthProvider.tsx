import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { browserLocalPersistence, GoogleAuthProvider, onAuthStateChanged, setPersistence, signInWithPopup, signOut, type User } from "firebase/auth";
import { firebaseServices } from "../../lib/firebase";
import { authErrorMessage } from "./errors";

type AuthState = { user: User | null; loading: boolean; busy: boolean; error: string; login: () => Promise<void>; logout: () => Promise<void> };
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
  useEffect(() => {
    const {auth} = firebaseServices();
    let active=true, unsubscribe=()=>{};
    setPersistence(auth,browserLocalPersistence).then(()=>{
      if (!active) return;
      unsubscribe=onAuthStateChanged(auth,next=>{setUser(next);setLoading(false);},reason=>{
        setUser(null);setError(authErrorMessage(reason));setLoading(false);
      });
    }).catch(reason=>{if(active){setError(authErrorMessage(reason));setLoading(false);}});
    return ()=>{active=false;unsubscribe();};
  }, []);
  async function login() {
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
    try { await signOut(firebaseServices().auth); setUser(null); }
    catch (reason) { setError(authErrorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <AuthContext.Provider value={{user, loading, busy, error, login, logout}}>{children}</AuthContext.Provider>;
}
