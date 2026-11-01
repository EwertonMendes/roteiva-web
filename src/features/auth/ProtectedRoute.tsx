import { Fragment, useLayoutEffect, type ReactNode } from "react";
import {applyTheme,readStoredTheme,systemTheme,themeStorageKey} from "../../lib/theme-preference";
import { useAuth } from "./AuthProvider";
import { LoginPage } from "./LoginPage";
export function ProtectedRoute({children}: {children: ReactNode}) {
  const {user, loading} = useAuth();
  // AccessGate and RegistrationGate can be visible before FirebaseWorkspace mounts.
  // Reconcile the authenticated account's palette before those screens paint.
  useLayoutEffect(()=>{
    if (!loading && user) applyTheme(readStoredTheme(themeStorageKey(user.uid)) ?? systemTheme());
  },[loading,user?.uid]);
  if (loading) return <main className="studio-loading" role="status">Verificando sua sessão…</main>;
  return user ? <Fragment key={user.uid}>{children}</Fragment> : <LoginPage />;
}
