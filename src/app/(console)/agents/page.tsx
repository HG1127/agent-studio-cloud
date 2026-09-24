import { CreateAgentForm } from "@/features/agents/CreateAgentForm";
import { AgentList } from "@/features/agents/AgentList";
import { ImportAgentForm } from "@/features/agents/ImportAgentForm";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { listAgents } from "@/server/queries/agents";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AgentsPage() {
  const agents = await listAgents(DEMO_WORKSPACE_ID);
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-10 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">助手列表</h1>
        <p className="text-sm text-gray-500">把一句业务需求变成一个能跑流程的助手。</p>
      </header>
      <AgentList agents={agents} />
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">创建新助手</h2>
        <CreateAgentForm />
      </section>
      <ImportAgentForm />
    </main>
  );
}
