import { PageLoadState } from "@/components/ui/PageLoadState";

export default function AcceptanceLoading() {
  return <PageLoadState title="正在读取验收中心" description="正在整理样例和最近验收证据；不会启动验收或发布版本。" cards={4} filters rows={3} />;
}
