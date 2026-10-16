import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!env.BUCKET) return Response.json({ error: "Armazenamento indisponível" }, { status: 503 });
  const mimeType = request.headers.get("content-type")?.split(";")[0] || "";
  const size = Number(request.headers.get("x-file-size"));
  let fileName: string;
  try { fileName = decodeURIComponent(request.headers.get("x-file-name") || ""); } catch { return Response.json({error:"Nome inválido"}, {status:400}); }
  if (!fileName || !request.body || !Number.isSafeInteger(size) || size <= 0 || size > 250 * 1024 * 1024) return Response.json({ error: "Selecione um arquivo de até 250 MB" }, { status: 400 });
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) !== size) return Response.json({error:"Tamanho do arquivo inválido"}, {status:400});
  const allowed = /^(video|audio|image)\//.test(mimeType) || ["application/pdf", "text/plain", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(mimeType);
  if (!allowed || mimeType === "image/svg+xml") return Response.json({ error: "Formato não suportado. Use vídeo, imagem, áudio, PDF, TXT, DOCX ou ZIP." }, { status: 415 });
  const key = `studio/${user.userId}/${crypto.randomUUID()}`;
  // Fixed length streaming bounds memory use and rejects truncated or oversized bodies.
  const stream = new FixedLengthStream(size);
  try {
    await Promise.all([
      request.body.pipeTo(stream.writable),
      env.BUCKET.put(key, stream.readable, { httpMetadata: { contentType: mimeType }, customMetadata: { fileName } }),
    ]);
  } catch { return Response.json({error:"Envio interrompido. Tente novamente."}, {status:400}); }
  return Response.json({ key, url: `/api/media?key=${encodeURIComponent(key)}`, mimeType });
}
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return new Response("Autenticação necessária", { status: 401 });
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!key.startsWith(`studio/${user.userId}/`)) return new Response("Não encontrado", { status: 404 });
  const object = await env.BUCKET?.get(key, { range: request.headers });
  if (!object) return new Response("Arquivo não encontrado", { status: 404 });
  const headers = new Headers({ "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
  if (new URL(request.url).searchParams.has("download")) headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(object.customMetadata?.fileName || "arquivo")}`);
  if (request.headers.has("range") && object.range && "offset" in object.range && "length" in object.range && object.range.offset !== undefined && object.range.length !== undefined) { headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`); headers.set("Content-Length", String(object.range.length)); }
  return new Response(object.body, { status: request.headers.has("range") && object.range ? 206 : 200, headers });
}
