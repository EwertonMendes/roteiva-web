import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, organizations } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária." }, { status: 401 });
  const db = getDb();
  const organizationId = `org_${user.userId}`;
  const rows = await db.select().from(clients).where(eq(clients.organizationId, organizationId)).orderBy(desc(clients.createdAt)).limit(200);
  return Response.json({ clients: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária." }, { status: 401 });
  const payload = await request.json().catch(() => ({})) as { name?: string; contactName?: string; contactEmail?: string; relationshipType?: "recurring" | "one_off" };
  const name = payload.name?.trim();
  if (!name || name.length > 120) return Response.json({ error: "Informe um nome válido." }, { status: 400 });
  const organizationId = `org_${user.userId}`;
  const db = getDb();
  await db.insert(organizations).values({ id: organizationId, name: "Sync Produções", ownerId: user.userId }).onConflictDoNothing();
  const [client] = await db.insert(clients).values({
    id: crypto.randomUUID(), organizationId, name,
    contactName: payload.contactName?.trim().slice(0, 120) || null,
    contactEmail: payload.contactEmail?.trim().slice(0, 180) || null,
    relationshipType: payload.relationshipType === "recurring" ? "recurring" : "one_off",
  }).returning();
  return Response.json({ client }, { status: 201 });
}
