import { PageLoadState } from "@/components/ui/PageLoadState";

export default function ConnectionsLoading() {
  return <PageLoadState title="正在读取外部工具登记" description="正在核对工具字段和连接入口；不会发起握手或业务调用。" cards={3} filters rows={3} />;
}
