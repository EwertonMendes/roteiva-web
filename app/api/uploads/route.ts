import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { assetVersions, deliverables, projects } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

const MAX_UPLOAD_BYTES = 750 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária." }, { status: 401 });
  if (!env.BUCKET) return Response.json({ error: "Armazenamento indisponível." }, { status: 503 });

  const form = await request.formData();
  const file = form.get("file");
  const deliverableId = String(form.get("deliverableId") || "").trim();
  const version = Number(form.get("version") || 1);
  if (!(file instanceof File) || !deliverableId) return Response.json({ error: "Arquivo e entrega são obrigatórios." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "O arquivo excede 750 MB." }, { status: 413 });
  if (!/^(video|audio|image)\//.test(file.type) && file.type !== "application/pdf") return Response.json({ error: "Formato não permitido." }, { status: 415 });

  const db = getDb();
  const [owned] = await db.select({id: deliverables.id}).from(deliverables)
    .innerJoin(projects, eq(deliverables.projectId, projects.id))
    .where(and(eq(deliverables.id, deliverableId), eq(projects.ownerId, user.userId)));
  if (!owned) return Response.json({ error: "Entrega não encontrada." }, { status: 404 });
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${user.userId}/${deliverableId}/${id}-${safeName}`;
  await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { ownerId: user.userId, originalName: file.name } });
  const [asset] = await db.insert(assetVersions).values({
    id, deliverableId, version: Math.max(1, Math.floor(version)), fileKey: key,
    fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, uploadedBy: user.userId,
  }).returning();
  return Response.json({ asset }, { status: 201 });
}
