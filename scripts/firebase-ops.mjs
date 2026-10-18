// This administrative helper is intentionally NEVER executed from the public repository.
// Firestore Admin REST bypasses client rules; only explicitly supported maintenance actions are allowed.
import { pathToFileURL } from "node:url";

export function validateOperation(operation, path, confirmation = "") {
  if (typeof path !== "string" || path.length > 300 ||
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)) {
    throw new Error("Invalid Firestore path");
  }
  const parts = path.split("/");
  if (operation === "read" && parts[0] === "users" && parts.length >= 2 &&
      parts.length % 2 === 0) return { operation, path };
  if (operation === "count" && parts[0] === "users" && parts.length >= 3 &&
      parts.length % 2 === 1) return { operation, path };
  if (operation === "read" && parts[0] === "opsFixtures" && parts.length === 2)
    return { operation, path };
  if (operation === "create-fixture" && parts[0] === "opsFixtures" && parts.length === 2)
    return { operation, path };
  if (operation === "delete-fixture" && parts[0] === "opsFixtures" &&
      parts.length === 2 && confirmation === "DELETE-DEV-FIXTURE")
    return { operation, path };
  throw new Error("Operation denied. Business writes require a reviewed, domain-specific maintenance script.");
}

async function request(project, accessToken, suffix, init = {}) {
  const url = "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(project) + "/databases/(default)/documents/" + suffix;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) throw new Error("Firestore request failed (" + response.status + ")");
  return response.status === 204 ? null : response.json();
}

async function execute() {
  if (process.env.GITHUB_REPOSITORY_PRIVATE !== "true" &&
      process.env.FIREBASE_OPS_TEST_MODE !== "true") {
    throw new Error("Private repository required");
  }
  const project = process.env.FIREBASE_PROJECT;
  if (project !== "roteiva-web-dev") throw new Error("Unexpected DEV project");
  const accessToken = process.env.ACCESS_TOKEN;
  if (!accessToken) throw new Error("Dedicated Firebase operations credential not configured");
  const {operation, path} = validateOperation(
    process.env.OPERATION, process.env.DOCUMENT_PATH, process.env.CONFIRMATION
  );

  // Values never appear in command lines or checked-in files. GitHub logs are private-only.
  if (operation === "read") {
    const result = await request(project, accessToken, path);
    console.log(JSON.stringify({operation, path, document: result}, null, 2));
  } else if (operation === "count") {
    let pageToken = "", count = 0, pages = 0;
    do {
      const query = new URLSearchParams({pageSize: "100", ...(pageToken ? {pageToken} : {})});
      const result = await request(project, accessToken, path + "?" + query);
      count += (result.documents || []).length;
      pageToken = result.nextPageToken || "";
      pages++;
      if (pages > 20) throw new Error("Count exceeds safe page limit; use an aggregate query");
    } while (pageToken);
    console.log(JSON.stringify({operation, collection: path, count}));
  } else if (operation === "create-fixture") {
    const body = {fields: {
      type: {stringValue: "roteiva-ops-check"},
      updatedAt: {timestampValue: new Date().toISOString()}
    }};
    await request(project, accessToken, path + "?currentDocument.exists=false", {
      method: "PATCH", body: JSON.stringify(body)
    });
    console.log(JSON.stringify({operation, path, status: "created"}));
  } else if (operation === "delete-fixture") {
    await request(project, accessToken, path, {method: "DELETE"});
    console.log(JSON.stringify({operation, path, status: "deleted"}));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  execute().catch(error => {
    // Never print HTTP error bodies: they can contain user data.
    console.error(error.message);
    process.exitCode = 1;
  });
}
