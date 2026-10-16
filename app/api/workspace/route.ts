import { workspaceSchema } from "../../studio-schema";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Banco indisponível" }, { status: 503 });
  const row = await env.DB.prepare("SELECT payload, revision FROM studio_workspaces WHERE owner_id = ?").bind(user.userId).first<{ payload: string; revision: number }>();
  return Response.json({ workspace: row ? JSON.parse(row.payload) : null, revision: row?.revision || 0 }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Banco indisponível" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 4_000_000) return Response.json({ error: "Espaço excede o limite de registros" }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Dados inválidos" }, { status: 400 }); }
  if (!body.workspace || !Array.isArray(body.workspace.projects) || !Array.isArray(body.workspace.financeEntries) || !Number.isInteger(body.revision)) return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const parsed = workspaceSchema.safeParse(body.workspace);
  if (!parsed.success) return Response.json({ error: "Há registros inválidos. Exporte uma cópia e revise os dados." }, { status: 400 });
  const payload = JSON.stringify(parsed.data);
  const result = body.revision === 0
    ? await env.DB.prepare("INSERT INTO studio_workspaces(owner_id, payload, revision) VALUES (?, ?, 1) ON CONFLICT DO NOTHING").bind(user.userId, payload).run()
    : await env.DB.prepare("UPDATE studio_workspaces SET payload = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE owner_id = ? AND revision = ?").bind(payload, user.userId, body.revision).run();
  if (!result.meta.changes) return Response.json({ error: "Outra janela atualizou os dados. Exporte uma cópia antes de recarregar." }, { status: 409 });
  return Response.json({ revision: body.revision + 1 });
}
