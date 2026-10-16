import DashboardClient from "./dashboard-client";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  const firstName = user.displayName.split(/[\s@]/)[0] || "Mateus";
  return <DashboardClient firstName={firstName} email={user.email} />;
}
