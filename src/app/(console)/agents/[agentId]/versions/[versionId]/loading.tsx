import { PageLoadState } from "@/components/ui/PageLoadState";

export default function FrozenVersionLoading() {
  return <PageLoadState title="正在读取冻结版本" description="正在读取这个版本的流程和业务约定；不会保存草稿、发布、恢复版本或启动运行。" cards={3} rows={3} />;
}
