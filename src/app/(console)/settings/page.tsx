import { ConnectionManager } from "@/features/settings/ConnectionManager";
import { realModelsEnabled } from "@/lib/model";
import { listModelConnections } from "@/server/queries/model-connections";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const enabled = realModelsEnabled();
  const connections = enabled ? await listModelConnections() : [];
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <h1 className="text-xl font-semibold text-gray-900">模型连接</h1>
      {enabled ? (
        <>
          <p className="mt-2 text-sm leading-6 text-gray-600">接入自己的模型服务，发布助手时选择使用哪个模型。密钥会加密保存，界面只显示末四位。</p>
          <div className="mt-6"><ConnectionManager initial={connections} /></div>
        </>
      ) : <p className="mt-2 text-sm text-gray-600">真实模型功能尚未开放。</p>}
    </main>
  );
}
