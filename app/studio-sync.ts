// Compare values rather than property order; server validation reorders object keys.
export function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined && key !== "monthlyRevenue" && key !== "preview").sort().map(key => `${JSON.stringify(key)}:${fingerprint(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export function draftRecovery(server: unknown, serverRevision: number, draft: {workspace: unknown; revision: number} | null) {
  if (!draft || fingerprint(server) === fingerprint(draft.workspace)) return "server";
  return draft.revision === serverRevision ? "draft" : "conflict";
}
