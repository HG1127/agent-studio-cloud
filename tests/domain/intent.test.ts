// 偏差说明：金测归一化在任务书给定的两条随机 id 正则之外，追加 `"createdAt":"…"` 归一化——
// 旧算法 buildRequirementContract 写入 new Date().toISOString()，与 randomUUID 同属不可复现值，
// 不做此替换则对齐测试永远红。除此之外与旧系统输出逐字节对齐。
// 另记（T5 补录）：caps 为 undefined 时新代码 `caps ?? []` 按空数组继续、旧代码在 caps.find/some
// 处崩溃（T4 审查发现的第 4 处等价改写偏差，当时漏记）。
import { describe, expect, it } from "vitest";
import golden1 from "../fixtures/domain/intent-golden-1.json";
import golden2 from "../fixtures/domain/intent-golden-2.json";
import { WorkflowDraft } from "@/contracts/workflow";
import {
  attachComplexIntentContract,
  compileIntentWorkflow,
  isConversationalOrMeta,
  splitIntentClauses,
} from "@/server/domain/intent";

function normalize(serialized: string): string {
  return serialized
    .replace(/agt_[0-9a-f]{8}/g, "agt_X")
    .replace(/WF-[0-9a-f-]+/g, "WF-X")
    .replace(/"createdAt":"[^"]*"/g, '"createdAt":"<ISO>"');
}

describe("意图解析移植对齐金测", () => {
  const cases = [
    ["intent-golden-1", golden1],
    ["intent-golden-2", golden2],
  ] as const;

  for (const [name, fixture] of cases) {
    it(`${name}：同输入产出与旧系统一致`, () => {
      const input = fixture.input;
      const out = compileIntentWorkflow(input);
      const enriched = out.workflow
        ? attachComplexIntentContract(
            out.workflow,
            { orderedSteps: out.orderedSteps, trigger: input.trigger, outputs: [] },
            input.text,
          )
        : null;
      expect(() => WorkflowDraft.parse(enriched)).not.toThrow();
      const actual = normalize(
        JSON.stringify({ workflow: enriched, orderedSteps: out.orderedSteps, analysis: out.analysis }),
      );
      const expected = normalize(JSON.stringify(fixture.output));
      expect(actual).toEqual(expected);
    });
  }
});

describe("纯函数直测", () => {
  it("isConversationalOrMeta 识别搭建/元意图", () => {
    expect(isConversationalOrMeta("帮我搭建一个调研agent")).toBe(true);
  });

  it("splitIntentClauses 按连接词拆分子句", () => {
    expect(splitIntentClauses("先读取资料，然后生成报告")).toHaveLength(2);
  });
});
