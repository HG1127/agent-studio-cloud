import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ deliver: vi.fn(), prepare: vi.fn(), read: vi.fn(), hook: vi.fn(), order: [] as string[] }));
vi.mock("@/server/steps/default-result-delivery-step", () => ({ deliverDefaultResultStep: mocks.deliver, prepareDefaultResultDeliveryWaitStep: mocks.prepare, readDefaultResultDeliveryStateStep: mocks.read }));
vi.mock("workflow", async (original) => ({ ...await original<typeof import("workflow")>(), createHook: mocks.hook }));
import { FatalError } from "workflow";
import { awaitDefaultResultDelivery } from "./default-result-delivery-hook";

const state = (status: "ready" | "waiting_review" | "confirmed" | "failed" | "sending") => ({ status, hookToken: "server-owned-frozen-token" });
beforeEach(() => { vi.clearAllMocks(); mocks.order.length = 0; mocks.prepare.mockResolvedValue(state("waiting_review")); });
function hook(conflict = false) {
  const dispose = vi.fn();
  const result = Object.assign(Promise.resolve({ kind: "delivery-updated" }), { getConflict: vi.fn(async () => conflict), dispose });
  mocks.hook.mockImplementation(() => { mocks.order.push("register"); return result; });
  return result;
}
describe("主流程等待成果核对，不轮询或重跑业务", () => {
  it("已确认投递直接结束，不注册等待", async () => {
    mocks.deliver.mockResolvedValue(state("confirmed"));
    await awaitDefaultResultDelivery("run");
    expect(mocks.hook).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("先注册再读，覆盖恢复动作先于Hook提交的终态", async () => {
    mocks.deliver.mockResolvedValue(state("waiting_review"));
    const waiting = hook();
    mocks.read.mockImplementation(async () => { mocks.order.push("read"); return state("confirmed"); });
    await awaitDefaultResultDelivery("run");
    expect(mocks.order).toEqual(["register", "read"]);
    expect(mocks.deliver).toHaveBeenCalledOnce();
    expect(waiting.dispose).toHaveBeenCalledOnce();
  });
  it("外部消息唤醒后只执行成果步骤，不返回编排起点", async () => {
    mocks.deliver.mockResolvedValueOnce(state("waiting_review")).mockResolvedValueOnce(state("confirmed"));
    mocks.read.mockResolvedValue(state("sending"));
    const waiting = hook();
    await awaitDefaultResultDelivery("run");
    expect(mocks.deliver).toHaveBeenCalledTimes(2);
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(waiting.dispose).toHaveBeenCalledOnce();
  });
  it("入口冲突是永久失败并释放Hook", async () => {
    mocks.deliver.mockResolvedValue(state("waiting_review"));
    const waiting = hook(true);
    await expect(awaitDefaultResultDelivery("run")).rejects.toBeInstanceOf(FatalError);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(waiting.dispose).toHaveBeenCalledOnce();
  });
  it("四轮安全发送前失败持续等待新消息，不耗尽步骤或重复业务", async () => {
    mocks.deliver.mockResolvedValueOnce(state("ready")).mockResolvedValueOnce(state("waiting_review"))
      .mockResolvedValueOnce(state("ready")).mockResolvedValueOnce(state("waiting_review"))
      .mockResolvedValueOnce(state("confirmed"));
    mocks.read.mockResolvedValue(state("waiting_review"));
    const waiting = hook();
    await awaitDefaultResultDelivery("run");
    expect(mocks.deliver).toHaveBeenCalledTimes(5);
    expect(mocks.prepare).toHaveBeenCalledTimes(4);
    expect(mocks.read).toHaveBeenCalledTimes(4);
    expect(mocks.hook).toHaveBeenCalledTimes(4);
    expect(waiting.dispose).toHaveBeenCalledTimes(4);
  });
  it("永久投递失败不虚报业务成果送达", async () => {
    mocks.deliver.mockResolvedValue(state("failed"));
    await expect(awaitDefaultResultDelivery("run")).rejects.toBeInstanceOf(FatalError);
    expect(mocks.hook).not.toHaveBeenCalled();
  });
});
