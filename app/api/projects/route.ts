import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, organizations, projects } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

const jsonError = (message: string, status: number) => Response.json({ error: message }, { status });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return jsonError("Autenticação necessária.", 401);
  const db = getDb();
  const rows = await db.select().from(projects).where(eq(projects.ownerId, user.userId)).orderBy(desc(projects.updatedAt)).limit(100);
  return Response.json({ projects: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return jsonError("Autenticação necessária.", 401);

  const body = await request.json().catch(() => ({})) as { name?: string; clientName?: string; description?: string; dueDate?: string };
  const name = body.name?.trim();
  const clientName = body.clientName?.trim();
  if (!name || name.length > 140) return jsonError("Informe um nome de projeto válido.", 400);
  if (!clientName || clientName.length > 100) return jsonError("Informe um cliente válido.", 400);

  const db = getDb();
  const organizationId = `org_${user.userId}`;
  const clientId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  await db.insert(organizations).values({ id: organizationId, name: "Sync Produções", ownerId: user.userId }).onConflictDoNothing();
  await db.insert(clients).values({ id: clientId, organizationId, name: clientName });
  const [project] = await db.insert(projects).values({
    id: projectId,
    organizationId,
    clientId,
    ownerId: user.userId,
    name,
    description: body.description?.trim().slice(0, 2000) || "",
    dueDate: body.dueDate || null,
  }).returning();

  return Response.json({ project }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return jsonError("Autenticação necessária.", 401);
  const body = await request.json().catch(() => ({})) as { id?: string; status?: "production" | "review" | "changes" | "approved" | "archived" };
  if (!body.id || !body.status) return jsonError("Projeto e status são obrigatórios.", 400);
  const db = getDb();
  const [project] = await db.update(projects).set({ status: body.status, updatedAt: new Date().toISOString() }).where(and(eq(projects.id, body.id), eq(projects.ownerId, user.userId))).returning();
  if (!project) return jsonError("Projeto não encontrado.", 404);
  return Response.json({ project });
}
