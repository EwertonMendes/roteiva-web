import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!env.DB || !env.BUCKET) return Response.json({ error: "Armazenamento indisponível" }, { status: 503 });
  const body = await request.json() as { assetId?: number };
  const row = await env.DB.prepare("SELECT payload FROM studio_workspaces WHERE owner_id = ?").bind(user.userId).first<{ payload: string }>();
  const asset = row && JSON.parse(row.payload).libraryAssets?.find((a: { id: number }) => a.id === body.assetId);
  if (!asset?.fileKey?.startsWith(`studio/${user.userId}/`)) return Response.json({ error: "Salve e envie o arquivo antes de compartilhar" }, { status: 400 });
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare("INSERT INTO studio_shares(token, owner_id, asset_id, title, file_key, mime_type) VALUES (?, ?, ?, ?, ?, ?)").bind(token, user.userId, asset.id, asset.name, asset.fileKey, asset.mimeType).run();
  return Response.json({ token, url: `/review?token=${token}` });
}
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária" }, { status: 401 });
  const rows = await env.DB?.prepare("SELECT token, asset_id, title, feedback, decision FROM studio_shares WHERE owner_id = ? ORDER BY created_at DESC").bind(user.userId).all();
  return Response.json({ shares: rows?.results || [] });
}
export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária" }, { status: 401 });
  const token = new URL(request.url).searchParams.get("token") || "";
  const result = await env.DB?.prepare("DELETE FROM studio_shares WHERE token = ? AND owner_id = ?").bind(token, user.userId).run();
  if (!result?.meta.changes) return Response.json({ error: "Link não encontrado" }, { status: 404 });
  return Response.json({ ok: true });
}
