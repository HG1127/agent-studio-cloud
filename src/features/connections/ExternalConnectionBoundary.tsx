import Link from "next/link";
import { ArrowRight, CircleAlert, KeyRound, Network, ShieldCheck } from "lucide-react";

export function ExternalConnectionBoundary({ registeredCount }: { registeredCount: number | null }) {
  return <section aria-labelledby="connection-boundary-title" className="content-card">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Network className="size-5 text-indigo-600" /><h2 id="connection-boundary-title" className="section-title">连接与工具不是同一件事</h2></div><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{registeredCount === null ? "当前工具登记目录暂时无法读取，数量尚无法核对；这不是没有登记工具。" : <>当前服务端登记了 {registeredCount} 项可供流程选择的业务工具。</>}登记清单来自服务端配置，不代表此工作区有可管理的外部连接，也不证明工具已通过连通或授权检查。</p></div><Link href="/agents" className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700">查看助手流程<ArrowRight className="size-4" /></Link></div>
    <div className="mt-5 grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><Network className="size-5 text-slate-500" /><h3 className="mt-3 text-sm font-semibold text-slate-900">连接与握手</h3><p className="mt-1 text-xs leading-5 text-slate-600">可检查管理员登记的连接。页面只显示名称并提交登记标识，地址和凭据由服务端读取。</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><CircleAlert className="size-5 text-slate-500" /><h3 className="mt-3 text-sm font-semibold text-slate-900">发现与复核</h3><p className="mt-1 text-xs leading-5 text-slate-600">检查会读取远端目录，核对已登记工具是否存在及输入定义是否一致，不新增或修改登记。</p></div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><ShieldCheck className="size-5 text-slate-500" /><h3 className="mt-3 text-sm font-semibold text-slate-900">授权与运行</h3><p className="mt-1 text-xs leading-5 text-slate-600">检查通过不代表获得业务授权或调用成功。实际运行仍需核对版本绑定、输出与业务权限；本页不能修改授权。</p></div>
    </div>
    <p className="mt-4 inline-flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><KeyRound className="mt-0.5 size-4 shrink-0" />新增连接仍由管理员在服务端登记。当前页面不收集密钥，也不接收连接地址；检查不会执行业务工具。</p>
  </section>;
}
