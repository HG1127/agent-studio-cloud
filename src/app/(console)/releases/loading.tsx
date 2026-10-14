import { PageLoadState } from "@/components/ui/PageLoadState";

export default function ReleasesLoading() {
  return <PageLoadState title="正在读取发布中心" description="正在整理候选、正式和历史版本；不会发布或恢复版本。" cards={3} filters rows={3} />;
}
