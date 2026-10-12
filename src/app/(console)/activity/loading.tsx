import { PageLoadState } from "@/components/ui/PageLoadState";

export default function ActivityLoading() {
  return <PageLoadState title="正在读取操作记录" description="正在按所选条件读取变更记录；不会写入或删除记录。" filters rows={5} />;
}
