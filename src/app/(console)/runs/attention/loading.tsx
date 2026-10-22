import { PageLoadState } from "@/components/ui/PageLoadState";

export default function RunAttentionLoading() {
  return <PageLoadState title="正在读取待处理任务" description="分别核对等待确认、等待继续、失败记录及助手范围，不会提交决定或启动任务。" cards={3} filters rows={3} />;
}
