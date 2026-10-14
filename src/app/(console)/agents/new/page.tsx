import Link from "next/link";
import { ArrowLeft, Bot } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { CreateAgentForm } from "@/features/agents/CreateAgentForm";
import { ImportAgentForm } from "@/features/agents/ImportAgentForm";

export default function NewAgentPage() {
  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="创建助手"
        title="把一项工作交给 AI"
        description="先说明要完成的真实工作，再按需补充资料、交付和限制；创建后会生成可继续调整的流程草稿。"
        action={<Link href="/agents" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"><ArrowLeft className="size-4" />返回助手列表</Link>}
      />
      <section className="content-card">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Bot className="size-5" /></span>
          <div><h2 className="section-title">创建新助手</h2><p className="mt-1 text-sm leading-6 text-slate-500">只需名称和目标即可开始；业务蓝图可以稍后在流程画布中继续完善。</p></div>
        </div>
        <CreateAgentForm />
      </section>
      <section className="content-card"><ImportAgentForm /></section>
    </main>
  );
}
