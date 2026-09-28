import Link from "next/link";
import { ArrowRight, CircleAlert, KeyRound, Network, ShieldCheck } from "lucide-react";

export function ExternalConnectionBoundary({ registeredCount }: { registeredCount: number }) {
  return <section aria-labelledby="connection-boundary-title" className="content-card">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Network className="size-5 text-indigo-600" /><h2 id="connection-boundary-title" className="section-title">连接与工具不是同一件事</h2></div><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">当前服务端登记了 {registeredCount} 项可供流程选择的业务工具。登记清单来自服务端配置，不代表此工作区有可管理的外部连接，也不证明工具已通过连通或授权检查。</p></div><Link href="/agents" className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700">查看助手流程<ArrowRight className="size-4" /></Link></div>
    <div className="mt-5 grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><Network className="size-5 text-slate-500" /><h3 className="mt-3 text-sm font-semibold text-slate-900">连接与握手</h3><p className="mt-1 text-xs leading-5 text-slate-600">尚无可读取的连接实例、凭据掩码或服务端握手结果。这里不会把工具登记项显示为已连接。</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><CircleAlert className="size-5 text-slate-500" /><h3 className="mt-3 text-sm font-semibold text-slate-900">发现与复核</h3><p className="mt-1 text-xs leading-5 text-slate-600">尚无协议工具发现和配置修订接口。不能在浏览器中填写地址后假装发现了可调用工具。</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><ShieldCheck className="size-5 text-slate-500" /><h3 className="mt-3 text-sm font-semibold text-slate-900">授权与运行</h3><p className="mt-1 text-xs leading-5 text-slate-600">尚无逐助手授权和协议执行路径。登记、选择与真正运行需要分开核对。</p></div>
    </div>
    <p className="mt-4 inline-flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><KeyRound className="mt-0.5 size-4 shrink-0" />连接凭据必须由服务端安全保存。当前页面不收集密钥，也不提供无法生效的“测试连接”按钮。</p>
  </section>;
}
