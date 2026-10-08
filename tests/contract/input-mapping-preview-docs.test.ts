import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InputMappingPreviewInput, InputMappingPreviewResult } from "@/contracts/input-mapping-preview";
import { getInputMappingPreview } from "@/server/queries/input-mapping-preview";

describe("字段试算接口文档", () => {
  it("完整请求及回执通过共享契约，实际查询试算与示例逐字段一致", async () => {
    const document = readFileSync(new URL("../../docs/input-mapping-preview-http-contract.md", import.meta.url), "utf8");
    const examples = [...document.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
    expect(examples).toHaveLength(2);
    const input = InputMappingPreviewInput.parse(examples[0]), expected = InputMappingPreviewResult.parse(examples[1]);
    expect(await getInputMappingPreview(input)).toEqual(expected);
    expect(await getInputMappingPreview({ ...input, outputs: {} })).toMatchObject({ ok: false, executed: false, code: "missing_source", fields: [{ status: "missing" }, { status: "provided" }, { status: "fallback" }] });
  });
});
