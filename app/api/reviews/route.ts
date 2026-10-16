import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { assetVersions, reviewComments, deliverables, projects } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária." }, { status: 401 });
  const payload = await request.json().catch(() => ({})) as { versionId?: string; body?: string; timecodeMs?: number; decision?: "changes" | "approved" };
  if (!payload.versionId) return Response.json({ error: "Versão obrigatória." }, { status: 400 });
  const db = getDb();
  const [owned] = await db.select({id: assetVersions.id}).from(assetVersions)
    .innerJoin(deliverables, eq(assetVersions.deliverableId, deliverables.id))
    .innerJoin(projects, eq(deliverables.projectId, projects.id))
    .where(and(eq(assetVersions.id, payload.versionId), eq(projects.ownerId, user.userId)));
  if (!owned) return Response.json({ error: "Versão não encontrada." }, { status: 404 });

  if (payload.decision) {
    const [version] = await db.update(assetVersions).set({ decision: payload.decision }).where(eq(assetVersions.id, payload.versionId)).returning();
    if (!version) return Response.json({ error: "Versão não encontrada." }, { status: 404 });
    return Response.json({ version });
  }

  const body = payload.body?.trim();
  if (!body || body.length > 3000) return Response.json({ error: "Comentário inválido." }, { status: 400 });
  const [comment] = await db.insert(reviewComments).values({
    id: crypto.randomUUID(), versionId: payload.versionId, authorId: user.userId,
    authorName: user.displayName, body, timecodeMs: Math.max(0, Math.floor(payload.timecodeMs || 0)),
  }).returning();
  return Response.json({ comment }, { status: 201 });
}
