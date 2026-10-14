import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { ToolOperationListInput } from "@/contracts/tool-operation";
import { ToolOperationWorkbench } from "@/features/tool-operations/ToolOperationWorkbench";

export const dynamic = "force-dynamic";

export default async function ToolOperationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const repeated = Object.values(query).some(Array.isArray);
  const filters = ToolOperationListInput.safeParse(repeated ? null : Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)));
  return <main className="page-shell">
    <PageHeader eyebrow="业务操作" title="工具结果人工核对" description="请求中断不代表操作未执行。先查询业务系统，再登记实际回执或确认未执行。" />
    {filters.success ? <ToolOperationWorkbench key={JSON.stringify(filters.data)} initialFilters={filters.data} /> : <section role="alert" className="content-card space-y-3">
      <h2 className="font-bold text-slate-900">筛选或翻页信息无法确认</h2><p className="text-sm text-slate-600">请重新打开核对列表。本次未读取记录，也未提交核对结论。</p>
      <Link href="/tool-operations" className="inline-flex rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">返回核对列表</Link>
    </section>}
  </main>;
}
