import type { Domain } from "../data/firestore-sync.ts";
import type { WorkspaceRoute } from "./workspace-routing.ts";

/** Keep all dependencies for each view's existing calculations and mutations.
 * Never display a partially loaded domain as a complete list.
 */
export function domainsForRoute(route:WorkspaceRoute):readonly Domain[] {
  switch(route.view) {
    case "settings":
      return [];
    case "library":
      return ["projects"];
    case "overview":
      return ["activities"];
    // Lists and details intentionally use the same closure of business domains.
    // This prevents a newly created record from being replaced by an older
    // server snapshot during immediate navigation to its detail route.
    case "projects":
      return route.projectId
        ? ["clients","projects","tasks","events","financeEntries","activities"]
        : ["clients","activities"];
    case "clients":
      return route.clientId
        ? ["clients","projects","financeEntries","deliveries","activities"]
        : ["projects","activities"];
    case "finance":
      return ["clients","projects","activities"];
    case "calendar":
      return ["projects","activities"];
    case "reviews":
      return ["clients","projects","tasks","activities"];
  }
}
