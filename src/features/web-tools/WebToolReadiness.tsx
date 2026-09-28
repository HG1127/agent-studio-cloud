import Link from "next/link";
import { ArrowRight, FileInput, FileOutput, Globe2, LockKeyhole, ShieldAlert } from "lucide-react";
import type { AgentTargetOption } from "@/contracts/agent";
import { AgentInputContract } from "@/contracts/manifest";
import { WorkflowDraft } from "@/contracts/workflow";
import { WebToolInputPreview } from "./WebToolInputPreview";

const INPUT_TYPES = { string: "文字", number: "数字", boolean: "是或否", object: "对象", array: "列表" } as const;

export function WebToolReadiness({ targets, selectedVersionId }: { targets: AgentTargetOption[]; selectedVersionId: string | null }) {
  const selected = targets.find((target) => target.versionId === selectedVersionId);
  const input = selected ? AgentInputContract.safeParse(selected.inputContract) : null;
  const output = selected ? WorkflowDraft.shape.outputContract.safeParse(selected.outputContract) : null;

  return <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.5fr)]">
    <section aria-labelledby="web-tool-source-title" className="content-card min-w-0 self-start">
      <div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Globe2 className="size-4" /></span><h2 id="web-tool-source-title" className="section-title">选择正式版本</h2></div>
      <p className="mt-2 text-sm leading-6 text-slate-600">只能核对当前真实的正式版本。选择不会创建网页入口，也不会改变助手。</p>
      {targets.length ? <form action="/web-tools" method="get" className="mt-5 space-y-3">
        <label htmlFor="web-tool-version" className="block text-sm font-medium text-slate-800">用于核对的助手版本</label>
        <select id="web-tool-version" name="version" defaultValue={selected?.versionId ?? ""} className="h-11 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
          <option value="" disabled>选择正式版本</option>
          {targets.map((target) => <option key={target.versionId} value={target.versionId}>{target.agentName} · 版本 {target.version}</option>)}
        </select>
        <button type="submit" className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">核对版本字段</button>
      </form> : <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">当前没有可核对的正式版本。请先完成助手验收与发布。<Link href="/releases" className="mt-3 inline-flex items-center gap-1 font-semibold text-indigo-700">查看发布中心<ArrowRight className="size-4" /></Link></div>}
    </section>

    <div className="min-w-0 space-y-4">
      {selected ? <>
        <section aria-labelledby="web-tool-contract-title" className="content-card min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">已保存的正式版本</p><h2 id="web-tool-contract-title" className="mt-1 break-words text-lg font-bold text-slate-950">{selected.agentName} · 版本 {selected.version}</h2></div><Link href={`/agents/${selected.agentId}#versions`} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700">查看助手版本<ArrowRight className="size-4" /></Link></div>
          <p className="mt-3 text-sm leading-6 text-slate-600">以下字段来自这个正式版本的已保存契约。下方仅预览填写布局；发布时还需要服务端确定访问方式、限额和调用结果。</p>
        </section>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section aria-labelledby="web-tool-input-title" className="content-card min-w-0"><div className="flex items-center gap-2"><FileInput className="size-5 text-indigo-600" /><h3 id="web-tool-input-title" className="section-title">业务输入</h3></div>
            {input?.success ? input.data.fields.length ? <ul className="mt-4 divide-y divide-slate-100">{input.data.fields.map((field) => <li key={field.name} className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2.5"><span className="min-w-0 break-words text-sm font-medium text-slate-800">{field.label || field.name}</span><span className="shrink-0 text-xs text-slate-500">{INPUT_TYPES[field.type]} · {field.required ? "必填" : "选填"}</span></li>)}</ul> : <p className="mt-4 text-sm leading-6 text-slate-500">该正式版本没有定义结构化输入字段。不能据此推断网页表单该收集什么。</p> : <p className="mt-4 text-sm leading-6 text-amber-800">这个版本的输入契约暂时无法读取，请先核对助手版本。</p>}
          </section>
          <section aria-labelledby="web-tool-output-title" className="content-card min-w-0"><div className="flex items-center gap-2"><FileOutput className="size-5 text-indigo-600" /><h3 id="web-tool-output-title" className="section-title">交付字段</h3></div>
            {output?.success && output.data ? output.data.fields.length ? <ul className="mt-4 divide-y divide-slate-100">{output.data.fields.map((field) => <li key={field.path} className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2.5"><span className="min-w-0 break-words text-sm font-medium text-slate-800">{field.label || field.path}</span><span className="shrink-0 text-xs text-slate-500">{field.required ? "需要交付" : "可选交付"}</span></li>)}</ul> : <p className="mt-4 text-sm leading-6 text-slate-500">该正式版本没有定义结构化交付字段。网页结果布局仍需单独设计与验证。</p> : <p className="mt-4 text-sm leading-6 text-amber-800">这个版本的交付契约暂时无法读取，请先核对助手版本。</p>}
          </section>
        </div>
        {input?.success ? <WebToolInputPreview key={selected.versionId} fields={input.data.fields} /> : null}
      </> : <section className="content-card flex min-h-64 flex-col items-center justify-center text-center"><ShieldAlert className="size-7 text-slate-400" /><h2 className="mt-3 text-base font-semibold text-slate-900">{selectedVersionId ? "找不到这个正式版本" : "等待选择正式版本"}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{selectedVersionId ? "版本可能已更改，或不属于当前工作区。请从左侧重新选择。" : "发布过助手后，可在这里核对网页工具可能需要的业务字段。"}</p></section>}
      <section aria-labelledby="web-tool-publish-boundary-title" className="content-card border-amber-200 bg-amber-50/40"><div className="flex items-center gap-2"><LockKeyhole className="size-5 text-amber-700" /><h2 id="web-tool-publish-boundary-title" className="section-title">当前不能发布网页工具</h2></div><p className="mt-2 text-sm leading-6 text-slate-700">云端尚无网页工具定义、发布、访问凭据和外部调用接口。这里不会生成网址或密钥，也不会把已有正式版本说成已对外开放。</p><p className="mt-2 text-xs leading-5 text-slate-500">接通服务端后，还需完成访问范围、调用限额、结果展示和撤销流程。</p></section>
    </div>
  </div>;
}
