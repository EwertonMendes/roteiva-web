import type { View } from "../domain/workspace.ts";

/** Browser URL is the source of truth for the active workspace screen.
 * Firebase Hosting uses clean paths; GitHub Pages uses hash paths so refresh works
 * without requiring a custom 404 handler or a separate application.
 */
export type WorkspaceRoute = { view: View; projectId?: number; clientId?: number };
export type RouteEnvironment = { base: string; useHash: boolean };

const pathByView: Record<View,string> = {
  overview: "/",
  projects: "/projetos",
  clients: "/clientes",
  reviews: "/aprovacoes",
  finance: "/financeiro",
  calendar: "/calendario",
  library: "/biblioteca",
  settings: "/configuracoes",
};

function basePath(base: string): string {
  return "/" + base.split("/").filter(Boolean).join("/") + (base.split("/").filter(Boolean).length ? "/" : "");
}

export function pathForWorkspaceRoute(route: WorkspaceRoute): string {
  const prefix=pathByView[route.view];
  if(route.view==="projects" && Number.isSafeInteger(route.projectId) && (route.projectId??0)>0) {
    return prefix+"/"+route.projectId;
  }
  if(route.view==="clients" && Number.isSafeInteger(route.clientId) && (route.clientId??0)>0) {
    return prefix+"/"+route.clientId;
  }
  return prefix;
}

export function parseWorkspacePath(input: string): WorkspaceRoute {
  const path=("/"+input.replace(/^\/+|\/+$/g,"")).replace(/\/{2,}/g,"/");
  if(path==="/") return {view:"overview"};
  const segments=path.split("/").filter(Boolean);
  if(segments.length===2 && (segments[0]==="projetos"||segments[0]==="clientes")) {
    const idText=segments[1];
    const id=Number(idText);
    if (/^[1-9][0-9]*$/.test(idText) && Number.isSafeInteger(id)) {
      return segments[0]==="projetos" ? {view:"projects",projectId:id} : {view:"clients",clientId:id};
    }
    // An invalid or missing entity ID safely opens the corresponding list.
    return {view:segments[0]==="projetos"?"projects":"clients"};
  }
  for(const [view,viewPath] of Object.entries(pathByView) as [View,string][]) {
    if(path===viewPath) return {view};
  }
  return {view:"overview"};
}

export function hrefForWorkspaceRoute(route: WorkspaceRoute,env: RouteEnvironment): string {
  const root=basePath(env.base);
  const path=pathForWorkspaceRoute(route);
  return env.useHash ? root+"#"+path : path==="/" ? root : root+path.slice(1);
}

export function routeFromLocation(location: Pick<Location,"pathname"|"hash">,env: RouteEnvironment): WorkspaceRoute {
  if(env.useHash) {
    return parseWorkspacePath(location.hash.startsWith("#/") ? location.hash.slice(1) : "/");
  }
  const root=basePath(env.base);
  const pathname=location.pathname;
  if(pathname===root.slice(0,-1) || pathname===root) return {view:"overview"};
  if(!pathname.startsWith(root)) return {view:"overview"};
  return parseWorkspacePath(pathname.slice(root.length));
}

export function sameWorkspaceRoute(a: WorkspaceRoute,b: WorkspaceRoute): boolean {
  return pathForWorkspaceRoute(a)===pathForWorkspaceRoute(b);
}
