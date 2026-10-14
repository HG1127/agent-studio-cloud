import { PageLoadState } from "@/components/ui/PageLoadState";

export default function HarnessLoading() {
  return <PageLoadState title="正在读取运行诊断" description="正在查询最近运行、步骤和已保存的轨迹，不会启动或重试任务。" rows={4} />;
}
