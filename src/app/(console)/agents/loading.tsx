import { PageLoadState } from "@/components/ui/PageLoadState";

export default function AgentsLoading() {
  return <PageLoadState title="正在读取助手列表" description="正在查找在用和已停用的助手；不会创建、停用或恢复助手。" filters rows={4} />;
}
