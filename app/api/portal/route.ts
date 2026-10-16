import { env } from "cloudflare:workers";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const row = await env.DB?.prepare("SELECT title, feedback, decision, file_key, mime_type FROM studio_shares WHERE token = ?").bind(url.searchParams.get("token") || "").first<{ title: string; feedback: string; decision: string; file_key: string; mime_type: string }>();
  if (!row) return Response.json({ error: "Link não encontrado" }, { status: 404 });
  if (url.searchParams.has("media")) {
    const file = await env.BUCKET?.get(row.file_key, { range: request.headers });
    if (!file) return new Response("Arquivo indisponível", { status: 404 });
    const headers = new Headers({ "Content-Type": row.mime_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
    if (request.headers.has("range") && file.range && "offset" in file.range && "length" in file.range && file.range.offset !== undefined && file.range.length !== undefined) { headers.set("Content-Range", `bytes ${file.range.offset}-${file.range.offset + file.range.length - 1}/${file.size}`); headers.set("Content-Length", String(file.range.length)); }
    return new Response(file.body, { status: request.headers.has("range") && file.range ? 206 : 200, headers });
  }
  return Response.json({ title: row.title, feedback: JSON.parse(row.feedback), decision: row.decision, mimeType: row.mime_type }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {token?:string;name?:string;decision?:string;text?:string;time?:number}|null;
  if (!body || typeof body.token !== "string" || typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) return Response.json({ error: "Informe seu nome" }, { status: 400 });
  const row = await env.DB?.prepare("SELECT feedback FROM studio_shares WHERE token = ?").bind(body.token).first<{ feedback: string }>();
  if (!row) return Response.json({ error: "Link não encontrado" }, { status: 404 });
  if (body.decision && !["approved", "changes"].includes(body.decision)) return Response.json({ error: "Decisão inválida" }, { status: 400 });
  if (!body.decision && (typeof body.text !== "string" || !body.text.trim() || body.text.length > 3000)) return Response.json({ error: "Escreva um comentário de até 3.000 caracteres" }, { status: 400 });
  const feedback = [...JSON.parse(row.feedback), { id: crypto.randomUUID(), name: body.name.trim(), text: body.decision === "approved" ? "Aprovou esta versão" : body.decision === "changes" ? "Solicitou ajustes" : body.text!.trim(), time: Number.isFinite(body.time) ? Math.max(0, body.time!) : 0, when: new Date().toISOString(), decision: body.decision || null }];
  if (feedback.length > 500) return Response.json({ error: "Limite de comentários desta versão atingido" }, { status: 400 });
  const result = body.decision
    ? await env.DB!.prepare("UPDATE studio_shares SET feedback = ?, decision = ? WHERE token = ? AND feedback = ?").bind(JSON.stringify(feedback), body.decision, body.token, row.feedback).run()
    : await env.DB!.prepare("UPDATE studio_shares SET feedback = ? WHERE token = ? AND feedback = ?").bind(JSON.stringify(feedback), body.token, row.feedback).run();
  if (!result.meta.changes) return Response.json({ error: "Outro comentário chegou. Atualize e tente novamente." }, { status: 409 });
  return Response.json({ ok: true });
}
