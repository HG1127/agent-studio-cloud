import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentManifest } from "@/contracts/manifest";
import { compareAgentVersions } from "@/server/domain/version-diff";
import { comparisonResourceView, versionComparisonDiffView, versionComparisonText } from "@/features/versions/version-comparison-presentation";
import { VersionComparisonSelection, frozenVersionComparisonReturnHref, versionComparisonDetailsHref, versionComparisonHref } from "@/features/versions/version-comparison-navigation";
import { frozenResourceBindingsView } from "@/features/versions/frozen-resource-bindings";
import VersionCompareLoading from "@/app/(console)/agents/[agentId]/versions/compare/loading";
import { frozenAgentId, frozenManifest, frozenVersionId } from "../fixtures/frozen-version";

const otherId = "00000000-0000-4000-8000-000000000073";
const pair = { from: otherId, to: frozenVersionId };

describe("版本比较展示与精确返回", () => {
  it("保留传入对比方向，详情只返回同助手同两份版本", () => {
    const href = versionComparisonHref(frozenAgentId, pair);
    expect(href).toBe(`/agents/${frozenAgentId}/versions/compare?from=${otherId}&to=${frozenVersionId}`);
    expect(versionComparisonDetailsHref(frozenAgentId, frozenVersionId, pair)).toBe(`/agents/${frozenAgentId}/versions/${frozenVersionId}?source=compare&from=${otherId}&to=${frozenVersionId}`);
    expect(frozenVersionComparisonReturnHref(frozenAgentId, frozenVersionId, { source: "compare", ...pair })).toBe(href);
    expect(frozenVersionComparisonReturnHref(frozenAgentId, otherId, { source: "compare", ...pair })).toBe(href);
  });

  it.each([{ from: [otherId, frozenVersionId], to: frozenVersionId }, { from: otherId, to: [frozenVersionId] }, { from: otherId, to: otherId }, { from: "https://evil.example", to: frozenVersionId }, {}])("无效或重复条件%j不改选其他版本", (query) => {
    expect(VersionComparisonSelection.safeParse(query).success).toBe(false);
    expect(frozenVersionComparisonReturnHref(frozenAgentId, frozenVersionId, { source: "compare", ...query })).toBeNull();
  });

  it("详情不属于对比两份或来源重复时拒绝回链，不开放外部返回", () => {
    expect(frozenVersionComparisonReturnHref(frozenAgentId, "00000000-0000-4000-8000-000000000074", { source: "compare", ...pair })).toBeNull();
    expect(frozenVersionComparisonReturnHref(frozenAgentId, frozenVersionId, { source: ["compare"], ...pair })).toBeNull();
    expect(frozenVersionComparisonReturnHref(frozenAgentId, frozenVersionId, { source: "https://evil.example", ...pair })).toBeNull();
    expect(() => versionComparisonDetailsHref(frozenAgentId, "00000000-0000-4000-8000-000000000074", pair)).toThrow();
  });

  it("规范化UUID大小写且同版本大小写差异不能成为两份版本", () => {
    const lower = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(VersionComparisonSelection.parse({ from: lower.toUpperCase(), to: frozenVersionId }).from).toBe(lower);
    expect(VersionComparisonSelection.safeParse({ from: lower.toUpperCase(), to: lower }).success).toBe(false);
  });

  it("只投影已有差异的显示标签，保留数量与所有真实变化布尔值", () => {
    const before = AgentManifest.parse(frozenManifest);
    const after = AgentManifest.parse({ ...frozenManifest, inputContract: { fields: [{ name: "privateInternalInput", type: "number" }] }, outputContract: { fields: [{ path: "privateInternalOutput.path", sourceNodeId: "compose" }] } });
    const diff = compareAgentVersions(before, after);
    const original = JSON.stringify(diff);
    const view = versionComparisonDiffView(diff, before, after, [frozenAgentId, frozenVersionId]);
    for (const key of ["nodes", "inputFields", "outputFields"] as const) for (const kind of ["added", "changed", "removed"] as const) expect(view[key][kind]).toHaveLength(diff[key][kind].length);
    for (const key of ["hasChanges", "workflowSettingsChanged", "modelChanged", "knowledgeChanged"] as const) expect(view[key]).toBe(diff[key]);
    expect(view.inputFields.added).toEqual(["未命名输入字段"]); expect(view.outputFields.added).toEqual(["未命名交付字段"]);
    expect(JSON.stringify(view)).not.toMatch(/privateInternalInput|privateInternalOutput/); expect(JSON.stringify(diff)).toBe(original);
  });

  it("显示文字隐藏已知关联、资料/模型标识和敏感内容，原数据不变", () => {
    const original = JSON.stringify(frozenManifest);
    const text = versionComparisonText(`业务说明 ${frozenAgentId} test-model frozen-fingerprint apiKey=private-comparison-secret`, [frozenManifest], [frozenVersionId]);
    expect(text).toContain("业务说明"); expect(text).not.toMatch(/00000000|test-model|frozen-fingerprint|private-comparison-secret/);
    expect(versionComparisonText("说明".repeat(150), [], [])).toHaveLength(181); expect(JSON.stringify(frozenManifest)).toBe(original);
  });

  it("比较不提供所属步骤定位，因此客户端不携带无用原节点标识", () => {
    const resource = frozenResourceBindingsView(frozenManifest, { originalSnapshotComplete: true });
    const original = JSON.stringify(resource);
    expect(resource.steps.some((step) => step.ownerNodeId !== null)).toBe(true);
    expect(comparisonResourceView(resource).steps.every((step) => step.ownerNodeId === null)).toBe(true);
    expect(JSON.stringify(resource)).toBe(original);
  });

  it("加载仅告知读取中，不补变化数量或资源可用结论", () => {
    const { container } = render(<VersionCompareLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("尚未计算变化或确认资源范围");
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/没有变化|明确保存了 0|资源可用/)).not.toBeInTheDocument();
  });
});
