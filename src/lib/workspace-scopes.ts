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
      return ["clients","projects","tasks","events","financeEntries","activities"];
    case "projects":
      return route.projectId
        ? ["clients","projects","tasks","events","financeEntries","activities"]
        : ["clients","projects","tasks","activities"];
    case "clients":
      return route.clientId
        ? ["clients","projects","financeEntries","deliveries","activities"]
        : ["clients","projects","financeEntries","activities"];
    case "finance":
      return ["financeEntries","clients","projects","activities"];
    case "calendar":
      return ["events","projects","activities"];
    case "reviews":
      return ["clients","projects","tasks","activities"];
  }
}
