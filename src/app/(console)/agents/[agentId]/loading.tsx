import { PageLoadState } from "@/components/ui/PageLoadState";

export default function AgentDetailLoading() {
  return <PageLoadState title="正在读取助手工作台" description="正在读取流程、版本与验收记录；不会保存流程、发布版本或启动运行。" cards={4} rows={4} />;
}
