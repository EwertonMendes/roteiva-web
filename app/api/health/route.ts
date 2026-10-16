export async function GET() {
  return Response.json({ ok: true, service: "syncflow", timestamp: new Date().toISOString() });
}
