import { PageLoadState } from "@/components/ui/PageLoadState";

export default function WebToolsLoading() {
  return <PageLoadState title="正在核对正式版本" description="正在读取已保存的输入与交付字段；不会创建网页工具。" cards={2} filters rows={3} />;
}
