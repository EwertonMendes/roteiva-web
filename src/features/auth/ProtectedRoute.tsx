import { Fragment, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { LoginPage } from "./LoginPage";
export function ProtectedRoute({children}: {children: ReactNode}) {
  const {user, loading} = useAuth();
  if (loading) return <main className="studio-loading" role="status">Verificando sua sessão…</main>;
  return user ? <Fragment key={user.uid}>{children}</Fragment> : <LoginPage />;
}
