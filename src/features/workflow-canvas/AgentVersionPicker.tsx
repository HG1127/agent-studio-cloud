"use client";

import type { AgentTargetOption } from "@/contracts/agent";

export function AgentVersionPicker({ label, targets, versionId = "", agentName, onSelect }: {
  label: string;
  targets: readonly AgentTargetOption[];
  versionId?: string;
  agentName?: string;
  onSelect: (target: AgentTargetOption | undefined) => void;
}) {
  const missing = Boolean(versionId && !targets.some((target) => target.versionId === versionId));
  return <div className="min-w-0 space-y-2">
    <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">{label}
      <select aria-label={label} value={versionId} onChange={(event) => {
        if (!event.target.value) onSelect(undefined);
        else {
          const target = targets.find((target) => target.versionId === event.target.value);
          if (target) onSelect(target);
        }
      }} className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
        <option value="">请选择已发布助手</option>
        {missing ? <option value={versionId}>{agentName || "原助手"}（已固定版本，当前清单未显示）</option> : null}
        {targets.map((target) => <option key={target.versionId} value={target.versionId}>{target.agentName}（版本 {target.version}）</option>)}
      </select>
    </label>
    {missing ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">原绑定已保留，不会自动换成其他版本。当前清单未显示不等于版本已失效；保存后的设计检查和运行会再次核对。</p>
      : targets.length === 0 ? <p className="text-xs leading-5 text-slate-500">当前没有可选的已发布助手，请先发布需要协作的助手。</p> : null}
  </div>;
}
