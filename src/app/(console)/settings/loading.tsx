import { PageLoadState } from "@/components/ui/PageLoadState";

export default function SettingsLoading() {
  return <PageLoadState title="正在读取管理设置" description="正在读取模型连接状态；不会保存、删除或测试连接。" cards={3} rows={2} />;
}
