import Link from "next/link";
import { ArrowRight, FileInput, FileOutput, Globe2, LockKeyhole, ShieldAlert } from "lucide-react";
import type { AgentTargetOption } from "@/contracts/agent";
import { AgentInputContract } from "@/contracts/manifest";
import { WorkflowDraft, type WorkflowVariable } from "@/contracts/workflow";
import { WebToolInputPreview } from "./WebToolInputPreview";
import { WebToolOutputPreview } from "./WebToolOutputPreview";
import { webToolInputLabel, webToolOutputLabel } from "./web-tool-field-label";
import { frozenVersionHref } from "@/features/versions/version-view-navigation";

const INPUT_TYPES = { string: "文字", number: "数字", boolean: "是或否", object: "对象", array: "列表" } as const;

export function WebToolReadiness({ targets, selectedVersionId, sourceStatus, inputDefinitions, descriptionsUnavailable = false }: { targets: AgentTargetOption[]; selectedVersionId: string | null; sourceStatus: string | null; inputDefinitions?: WorkflowVariable[]; descriptionsUnavailable?: boolean }) {
  const selected = targets.find((target) => target.versionId === selectedVersionId);
  const input = selected ? AgentInputContract.safeParse(selected.inputContract) : null;
  const output = selected ? WorkflowDraft.shape.outputContract.safeParse(selected.outputContract) : null;
  const verified = !descriptionsUnavailable && (sourceStatus === "production" || sourceStatus === "retired");
  const historical = verified && sourceStatus === "retired";
  const trialTarget = verified && input?.success && output?.success ? selected : undefined;

  return <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.5fr)]">
    <section aria-labelledby="web-tool-source-title" className="content-card min-w-0 self-start">
      <div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Globe2 className="size-4" /></span><h2 id="web-tool-source-title" className="section-title">{historical ? "核对所选历史版本" : "选择正式版本"}</h2></div>
      <p className="mt-2 text-sm leading-6 text-slate-600">清单提供当前正式版本，也可保留网址明确指定且已核对的历史版本。没有列出全部历史版本；选择不会创建网页入口、恢复正式状态或改变助手。</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">重新选择会移除网址中的运行关联，不删除运行记录；尚未提交的试填内容不会保留。</p>
      {targets.length ? <form action="/web-tools" method="get" data-web-tool-version-form className="mt-5 space-y-3">
        <label htmlFor="web-tool-version" className="block text-sm font-medium text-slate-800">用于核对的助手版本</label>
        <select id="web-tool-version" name="version" defaultValue={selected?.versionId ?? ""} className="h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
          <option value="" disabled>选择正式版本</option>
          {targets.map((target) => <option key={target.versionId} value={target.versionId} disabled={target.versionId === selectedVersionId && !verified}>{target.agentName} · 版本 {target.version} · {target.versionId === selectedVersionId ? historical ? "所选历史版本" : verified ? "当前正式版本" : "来源尚无法核对" : "当前正式版本"}</option>)}
        </select>
        <button type="submit" className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">核对版本字段</button>
      </form> : <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">当前没有可核对的正式版本。请先完成助手验收与发布。<Link href="/releases" className="mt-3 inline-flex items-center gap-1 font-semibold text-indigo-700">查看发布中心<ArrowRight className="size-4" /></Link></div>}
    </section>

    <div className="min-w-0 space-y-4">
      {selected ? <>
        <section aria-labelledby="web-tool-contract-title" className="content-card min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">{historical ? "所选历史版本的已保存来源" : verified ? "当前正式版本的已保存来源" : "所选版本来源尚无法核对"}</p><h2 id="web-tool-contract-title" className="mt-1 break-words text-lg font-bold text-slate-950">{selected.agentName} · 版本 {selected.version}</h2></div><Link href={`/agents/${selected.agentId}#versions`} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700">查看助手版本<ArrowRight className="size-4" /></Link></div>
          <p className="mt-3 text-sm leading-6 text-slate-600">{verified ? "以下字段来自所选已保存版本的契约，填写说明也只取自同一个版本。可核对格式，并另行确认创建内部试运行；网页发布仍需服务端确定访问方式、限额和调用结果。" : "以下仅保留本次版本清单已读取的字段，用于本页核对格式。完整来源或状态尚未核对，不能发起新的试运行，也没有自动换用其他版本。"}</p>
          {historical ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">这是已保存的历史版本，不是当前正式版本。试运行仍固定使用所选版本，由服务端再次核对资格；不会恢复为正式版本或改用新版。</p> : null}
          {sourceStatus === "candidate" ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">所选版本尚待发布核对，不能用于新的内部试运行；没有把它当作正式或可运行的历史版本。</p> : null}
          {verified ? <Link href={frozenVersionHref(selected.agentId, selected.versionId, { source: "web-tools", versionsPage: 1, archivedCasesPage: 1, evaluationRunsPage: 1 })} prefetch={false} className="mt-3 inline-flex text-sm font-semibold text-indigo-700">只读核对这个版本的流程</Link> : null}
        </section>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section aria-labelledby="web-tool-input-title" className="content-card min-w-0"><div className="flex items-center gap-2"><FileInput className="size-5 text-indigo-600" /><h3 id="web-tool-input-title" className="section-title">业务输入</h3></div>
            {input?.success ? input.data.fields.length ? <ul className="mt-4 divide-y divide-slate-100">{input.data.fields.map((field, index) => <li key={field.name} className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2.5"><span className="min-w-0 break-words text-sm font-medium text-slate-800">{webToolInputLabel(field, index)}</span><span className="shrink-0 text-xs text-slate-500">{INPUT_TYPES[field.type]} · {field.required ? "必填" : "选填"}</span></li>)}</ul> : <p className="mt-4 text-sm leading-6 text-slate-500">所选已保存版本没有定义结构化输入字段。不能据此推断网页表单应收集什么。</p> : <p className="mt-4 text-sm leading-6 text-amber-800">这个版本的输入契约暂时无法读取，请先核对助手版本。</p>}
          </section>
          <section aria-labelledby="web-tool-output-title" className="content-card min-w-0"><div className="flex items-center gap-2"><FileOutput className="size-5 text-indigo-600" /><h3 id="web-tool-output-title" className="section-title">交付字段</h3></div>
            {output?.success ? output.data?.fields.length ? <ul className="mt-4 divide-y divide-slate-100">{output.data.fields.map((field, index) => <li key={`${index}:${field.path}`} className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2.5"><span className="min-w-0 break-words text-sm font-medium text-slate-800">{webToolOutputLabel(field, index)}</span><span className="shrink-0 text-xs text-slate-500">{field.required ? "需要交付" : "可选交付"}</span></li>)}</ul> : <p className="mt-4 text-sm leading-6 text-slate-500">所选已保存版本没有定义结构化交付字段。网页结果布局仍需单独设计与验证。</p> : <p className="mt-4 text-sm leading-6 text-amber-800">这个版本的交付契约暂时无法读取，请先核对助手版本。</p>}
          </section>
        </div>
        {descriptionsUnavailable ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">本版本的填写说明暂时无法核对，以下只展示已读取的字段与格式要求，没有借用草稿说明。可重新核对版本字段；这不代表该版本没有说明。</p> : null}
        {input?.success ? <WebToolInputPreview key={`input:${selected.versionId}`} fields={input.data.fields} inputDefinitions={inputDefinitions} trialTarget={trialTarget} /> : null}
        {output?.success ? <WebToolOutputPreview key={`output:${selected.versionId}`} fields={output.data?.fields ?? []} /> : null}
      </> : <section className="content-card flex min-h-64 flex-col items-center justify-center text-center"><ShieldAlert className="size-7 text-slate-400" /><h2 className="mt-3 text-base font-semibold text-slate-900">{selectedVersionId ? "找不到所选版本" : "等待选择正式版本"}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{selectedVersionId ? "版本可能已更改，或不属于当前工作区。请从左侧重新选择。" : "发布过助手后，可在这里核对网页工具可能需要的业务字段。"}</p></section>}
      <section aria-labelledby="web-tool-publish-boundary-title" className="content-card border-amber-200 bg-amber-50/40"><div className="flex items-center gap-2"><LockKeyhole className="size-5 text-amber-700" /><h2 id="web-tool-publish-boundary-title" className="section-title">当前不能发布网页工具</h2></div><p className="mt-2 text-sm leading-6 text-slate-700">云端尚无网页工具定义、发布、访问凭据和外部调用接口。这里不会生成网址或密钥，也不会把已有正式版本说成已对外开放。</p><p className="mt-2 text-xs leading-5 text-slate-500">接通服务端后，还需完成访问范围、调用限额、结果展示和撤销流程。</p></section>
    </div>
  </div>;
}
