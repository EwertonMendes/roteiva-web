export function parseMoney(value: string) {
  const normalized = value.trim().includes(",") ? value.trim().replaceAll(".", "").replace(",", ".") : value.trim();
  return Math.round(Number(normalized) * 100) / 100;
}
export function splitInstallments(amount: number, count: number, date: Date) {
  const cents = Math.round(amount * 100);
  if (!Number.isInteger(count) || count < 1 || count > 24 || !Number.isFinite(cents) || cents < count || !Number.isFinite(date.getTime())) throw new Error("Informe um valor, data e parcelamento válidos");
  return Array.from({length: count}, (_, i) => {
    const next = new Date(date.getFullYear(), date.getMonth() + i, 1, 12);
    next.setDate(Math.min(date.getDate(), new Date(next.getFullYear(), next.getMonth()+1, 0).getDate()));
    return {amount: (Math.floor(cents/count) + (i < cents % count ? 1 : 0))/100, date: next.toLocaleDateString("pt-BR")};
  });
}
export function sumMoney(entries: {amount:number}[]) { return entries.reduce((total,entry)=>total+Math.round(entry.amount*100),0)/100; }
export function toISO(date: string) { return /^\d{2}\/\d{2}\/\d{4}$/.test(date) ? date.split("/").reverse().join("-") : date; }
