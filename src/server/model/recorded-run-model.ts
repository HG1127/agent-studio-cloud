import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { FatalError } from "workflow";
import { ModelCallSettlement, ModelCallStartInput } from "@/contracts/model-usage";
import { modelCallFailure, modelUsageLabel, readReportedModelUsage } from "@/server/domain/model-usage";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { beginRunModelCall, settleRunModelCall } from "@/server/services/model-call";

async function settleWithoutRecallingModel(value: ModelCallSettlement) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { await settleRunModelCall(value); return; }
    catch (error) { if (attempt === 1) console.error("模型调用结果未确认，原记录保留未知状态", safeErrorForLog(error)); }
  }
}
export function recordRunModel(model: Parameters<typeof wrapLanguageModel>[0]["model"], input: ModelCallStartInput) {
  const args = ModelCallStartInput.parse({ ...input, nodeTitle: modelUsageLabel(input.nodeTitle), modelId: modelUsageLabel(input.modelId) });
  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      const identity = await beginRunModelCall(args);
      let result;
      try { result = await doGenerate(); }
      catch (error) {
        await settleWithoutRecallingModel({ ...identity, state: "failed", measurement: null, failure: modelCallFailure(error, params.abortSignal?.aborted === true) });
        throw error;
      }
      // 响应已取得；补记失败不能触发供应商重试，持久 pending 明确保留未知，不伪报零用量。
      await settleWithoutRecallingModel({ ...identity, state: "returned", measurement: readReportedModelUsage(result.usage), failure: null });
      return result;
    },
    wrapStream: async () => { throw new FatalError("运行用量记录暂不支持流式模型调用"); },
  };
  return wrapLanguageModel({ model, middleware });
}
