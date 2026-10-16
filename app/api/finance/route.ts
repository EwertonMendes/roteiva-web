import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "../../../db";
import { financeEntries, organizations } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária." }, { status: 401 });
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return Response.json({ error: "Ano inválido." }, { status: 400 });
  const db = getDb();
  const rows = await db.select().from(financeEntries).where(and(eq(financeEntries.ownerId, user.userId), gte(financeEntries.competenceMonth, `${year}-01`), lt(financeEntries.competenceMonth, `${year + 1}-01`))).orderBy(desc(financeEntries.competenceMonth), desc(financeEntries.createdAt)).limit(1000);
  const totals = Array.from({ length: 12 }, () => 0);
  for (const row of rows) {
    const month = Number(row.competenceMonth.slice(5, 7)) - 1;
    if (month >= 0 && month < 12) totals[month] += row.amountCents;
  }
  return Response.json({ entries: rows, monthlyTotalsCents: totals });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Autenticação necessária." }, { status: 401 });
  const payload = await request.json().catch(() => ({})) as { title?: string; clientName?: string; amountCents?: number; status?: "received" | "pending"; competenceMonth?: string; dueDate?: string };
  const title = payload.title?.trim();
  const clientName = payload.clientName?.trim();
  const amountCents = Math.round(Number(payload.amountCents));
  if (!title || !clientName || !Number.isSafeInteger(amountCents) || amountCents <= 0) return Response.json({ error: "Título, cliente e valor positivo são obrigatórios." }, { status: 400 });
  const competenceMonth = /^\d{4}-\d{2}$/.test(payload.competenceMonth || "") ? payload.competenceMonth! : new Date().toISOString().slice(0, 7);
  const organizationId = `org_${user.userId}`;
  const db = getDb();
  await db.insert(organizations).values({ id: organizationId, name: "Sync Produções", ownerId: user.userId }).onConflictDoNothing();
  const [entry] = await db.insert(financeEntries).values({
    id: crypto.randomUUID(), organizationId, ownerId: user.userId, title, clientName,
    amountCents, status: payload.status === "received" ? "received" : "pending",
    competenceMonth, dueDate: payload.dueDate || null,
    receivedAt: payload.status === "received" ? new Date().toISOString() : null,
  }).returning();
  return Response.json({ entry }, { status: 201 });
}
