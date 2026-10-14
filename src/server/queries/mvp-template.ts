import "server-only";
import { MvpTemplateAvailability } from "@/contracts/mvp-template";
import { listToolRegistryOptions } from "@/server/tools/tool-registry";

export async function getMvpTemplateAvailability(): Promise<MvpTemplateAvailability> {
  return MvpTemplateAvailability.parse({ tools: listToolRegistryOptions(), requirements: [
    "填写业务目标、规则、必填输入和防重编号",
    "选择已登记的只读取数工具和具备防重保证的业务操作工具",
    "根据工具真实字段逐项配置参数映射和最终交付",
    "创建保存草稿；发布和启动需要另外操作，运行中先由负责人确认方案",
  ] });
}
