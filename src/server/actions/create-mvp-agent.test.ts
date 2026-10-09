import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentExportFile } from "@/contracts/agent";
import { mvpTemplateInput, mvpTemplateRegistry, mvpHttpAction } from "../../../tests/fixtures/mvp-template";

const mocks = vi.hoisted(() => ({ listTools: vi.fn(), importAgent: vi.fn() }));
vi.mock("@/server/tools/tool-registry", () => ({ listToolRegistryOptions: mocks.listTools }));
vi.mock("@/server/actions/import-agent", () => ({ importAgentAction: mocks.importAgent }));
import { createMvpAgentAction } from "./create-mvp-agent";

const requestId = "00000000-0000-4000-8000-000000000099";
describe("从模板创建真实业务草稿", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTools.mockReturnValue(mvpTemplateRegistry);
    mocks.importAgent.mockResolvedValue({ ok: true, agentId: requestId });
  });
  it.each([mvpTemplateRegistry[1], mvpHttpAction])("复用原子保存入口，不执行工具或启动模型", async (action) => {
    mocks.listTools.mockReturnValue([mvpTemplateRegistry[0], action]);
    expect(await createMvpAgentAction(mvpTemplateInput, requestId)).toEqual({ ok: true, agentId: requestId });
    expect(mocks.importAgent).toHaveBeenCalledTimes(1);
    const [raw, id] = mocks.importAgent.mock.calls[0];
    const exported = AgentExportFile.parse(raw);
    expect(id).toBe(requestId);
    expect(exported.workflow.nodes.execute.tool?.registryToolId).toBe(action.id);
    expect(exported.workflow.versionId).toBeNull();
    expect(exported.agent.name).toBe(mvpTemplateInput.name);
  });
  it.each([
    [{ ...mvpTemplateInput, businessRules: "" }, requestId],
    [mvpTemplateInput, "wrong-request"],
    [{ ...mvpTemplateInput, endpoint: "https://example.com", apiKey: "secret" }, requestId],
  ])("非法参数不能进入保存入口", async (input, id) => {
    expect((await createMvpAgentAction(input, id)).ok).toBe(false);
    expect(mocks.listTools).not.toHaveBeenCalled();
    expect(mocks.importAgent).not.toHaveBeenCalled();
  });
  it("工具缺失时不保存空壳助手", async () => {
    mocks.listTools.mockReturnValue([]);
    expect((await createMvpAgentAction(mvpTemplateInput, requestId)).ok).toBe(false);
    expect(mocks.importAgent).not.toHaveBeenCalled();
  });
  it("原保存入口的失败不得改报成功", async () => {
    mocks.importAgent.mockResolvedValue({ ok: false, error: "保存失败" });
    expect(await createMvpAgentAction(mvpTemplateInput, requestId)).toEqual({ ok: false, error: "保存失败" });
  });
  it("同一创建请求重复提交，稳定内容交原入口裁决防重", async () => {
    await createMvpAgentAction(mvpTemplateInput, requestId);
    await createMvpAgentAction(mvpTemplateInput, requestId);
    const first = mocks.importAgent.mock.calls[0], second = mocks.importAgent.mock.calls[1];
    expect(first[1]).toBe(second[1]);
    expect(first[0].workflow).toEqual(second[0].workflow);
    expect(first[0].agent).toEqual(second[0].agent);
  });
});
