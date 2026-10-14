import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EvaluationCaseSnapshot } from "@/contracts/evaluation";
import { evaluateExpectations } from "@/server/domain/evaluation";

describe("结果字段规则文档", () => {
  it("共享契约接受完整文档样例，规则对正确与错误业务结果真实生效", () => {
    const document = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const section = document.split("## 验收结果字段规则")[1]?.split(/\n## /)[0];
    expect(section).toBeTruthy();
    const examples = [...section!.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
    expect(examples).toHaveLength(2);
    const snapshot = EvaluationCaseSnapshot.parse(examples[0]);
    expect(snapshot.resultSchema).toBeTruthy();
    const options = { resultSchema: snapshot.resultSchema };
    expect(evaluateExpectations(examples[1], snapshot.expectations, options)).toEqual({ passed: true, errors: [] });
    for (const result of [{ orders: [] }, { orders: [{ amount: 101, approved: false }] }, { orders: [{ amount: "0", approved: false }] }, { orders: [{ approved: false }] }]) {
      expect(evaluateExpectations(result, snapshot.expectations, options).passed).toBe(false);
    }
  });
});
