import { PageLoadState } from "@/components/ui/PageLoadState";

export default function ToolOperationsLoading() {
  return <PageLoadState title="正在打开业务核对工作台" description="读取记录后再展示实际状态，加载期间不会提交核对结论。" filters rows={3} />;
}
