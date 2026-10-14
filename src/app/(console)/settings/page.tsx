import { ConnectionManager } from "@/features/settings/ConnectionManager";
import { realModelsEnabled } from "@/lib/model";
import { resolveEncryptionKey } from "@/server/domain/crypto";
import { listModelConnections } from "@/server/queries/model-connections";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const enabled = realModelsEnabled();
  const connections = enabled ? await listModelConnections() : [];
  const encryptionReady = resolveEncryptionKey(process.env.MODEL_ENCRYPTION_KEY) !== null;
  return (
    <main className="page-shell">
      <PageHeader eyebrow="工作区" title="管理设置" description="连接模型服务，并进入定时任务与操作记录。" />
      <div aria-label="管理设置分类" className="grid gap-3 sm:grid-cols-3">
        <Link href="/settings" aria-current="page" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-semibold text-indigo-700">模型连接<span className="mt-1 block text-xs font-normal text-indigo-500">配置可用于发布的模型</span></Link>
        <Link href="/schedules" className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800">定时任务<span className="mt-1 block text-xs font-normal text-slate-500">管理自动运行计划</span></Link>
        <Link href="/activity" className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800">操作记录<span className="mt-1 block text-xs font-normal text-slate-500">追踪关键变更</span></Link>
      </div>
      <section className="content-card">
      <h2 className="section-title">模型连接</h2>
      {enabled ? (
        <>
          <p className="mt-2 text-sm leading-6 text-gray-600">接入自己的模型服务，发布助手时选择使用哪个模型。密钥会加密保存，界面只显示末四位。</p>
          <div className="mt-6"><ConnectionManager initial={connections} encryptionReady={encryptionReady} /></div>
        </>
      ) : <p className="mt-2 text-sm text-gray-600">真实模型功能尚未开放。</p>}
      </section>
    </main>
  );
}
