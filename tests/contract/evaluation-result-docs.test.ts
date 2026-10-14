import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EvaluationCaseSnapshot } from "@/contracts/evaluation";
import { evaluateExpectations } from "@/server/domain/evaluation";

describe("数组字段验收文档", () => {
  it("实际共享契约接受完整样例，文档结果通过且错误业务值仍失败", () => {
    const document = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const section = document.split("## 验收数组字段")[1]?.split(/\n## /)[0];
    expect(section).toBeTruthy();
    const examples = [...section!.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
    expect(examples).toHaveLength(2);
    const snapshot = EvaluationCaseSnapshot.parse(examples[0]);
    expect(evaluateExpectations(examples[1], snapshot.expectations)).toEqual({ passed: true, errors: [] });
    expect(evaluateExpectations({ items: [{ amount: 10, approved: true, labels: ["到货确认"] }] }, snapshot.expectations).passed).toBe(false);
    expect(evaluateExpectations({ items: [] }, snapshot.expectations).passed).toBe(false);
  });
});
