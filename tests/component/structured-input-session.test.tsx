import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentInputField } from "@/contracts/manifest";
import { useStructuredInputSession } from "@/features/inputs/use-structured-input-session";

const fields: AgentInputField[] = [
  { name: "items", label: "业务清单", type: "array", required: true },
  { name: "details", label: "业务对象", type: "object", required: false },
  { name: "brief", label: "业务正文", type: "string", required: true },
];
afterEach(() => cleanup());

describe("结构化输入父会话的同步状态和共享边界", () => {
  it("同一次交互的逐字段更新同步保留全部填写与单调修订，不借用旧render值", () => {
    const { result } = renderHook(() => useStructuredInputSession(fields, () => false));
    act(() => {
      result.current.update("items", "[0,false]");
      result.current.update("brief", "  第一行\n第二行  ");
      result.current.update("items", '[0,false,"更新"]');
      expect(result.current.valuesRef.current).toEqual({ items: '[0,false,"更新"]', brief: "  第一行\n第二行  " });
    });
    expect(result.current.values).toEqual({ items: '[0,false,"更新"]', brief: "  第一行\n第二行  " });
    expect(result.current.revisions).toEqual({ items: 2, brief: 1 });
  });

  it("本地草稿同步挡住准备输入，仅匹配owner与原修订的取消可以清除", () => {
    const { result } = renderHook(() => useStructuredInputSession(fields, () => false));
    act(() => {
      result.current.reportPending("items", "旧编辑器", 0, true);
      expect(result.current.firstPendingIndex()).toBe(0);
      result.current.reportPending("items", "旧编辑器", 0, false);
      result.current.reportPending("items", "新编辑器", 0, true);
      result.current.reportPending("items", "旧编辑器", 0, true);
      result.current.reportPending("items", "旧编辑器", 0, false);
    });
    expect(result.current.pendingCount).toBe(1);
    act(() => result.current.reportPending("items", "新编辑器", 0, false));
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.values).toEqual({});
  });

  it("原始格式填写发生ABA变化后，旧预览既不能应用也不能清掉新草稿", () => {
    const { result } = renderHook(() => useStructuredInputSession(fields, () => false));
    act(() => result.current.update("items", "[0]"));
    const originalRevision = result.current.revisions.items;
    act(() => {
      result.current.reportPending("items", "旧编辑器", originalRevision, true);
      result.current.update("items", "[1]");
      result.current.update("items", "[0]");
      result.current.reportPending("items", "新编辑器", originalRevision + 2, true);
      expect(result.current.apply("items", "[99]", originalRevision)).toBe(false);
      result.current.reportPending("items", "旧编辑器", originalRevision, false);
    });
    expect(result.current.values.items).toBe("[0]");
    expect(result.current.pendingCount).toBe(1);
  });

  it("锁定不仅禁用元素，也拒绝程序触发的更新、应用、新草稿和重置", () => {
    let locked = false;
    const { result } = renderHook(() => useStructuredInputSession(fields, () => locked));
    act(() => result.current.update("items", "[0,false]"));
    locked = true;
    act(() => {
      expect(result.current.update("items", "[99]")).toBe(false);
      expect(result.current.apply("items", "[]", 1)).toBe(false);
      result.current.reportPending("items", "程序触发", 1, true);
      result.current.reset();
    });
    expect(result.current.values.items).toBe("[0,false]");
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.revisions.items).toBe(1);
  });

  it("应用只改目标字段，不强迫未填必填项提前填好，保留对象、零、否和文本前导零", () => {
    const { result } = renderHook(() => useStructuredInputSession(fields, () => false));
    act(() => result.current.apply("items", '[0,false,{"编号":"001","子项":[null,0]}]', 0));
    expect(result.current.values.items).toBe('[0,false,{"编号":"001","子项":[null,0]}]');
    expect(result.current.values.brief).toBeUndefined();
    expect(result.current.draftError).toBeNull();
    expect(result.current.applied).toBe(true);
  });

  it.each(['{"错误":"不是列表"}', "invalid", '[{"constructor":"保留字段"}]', '[{"__proto__":"保留字段"}]'])("结构格式与保留键 %s 被共享契约拒绝，原填写和待应用状态保留", (nextText) => {
    const { result } = renderHook(() => useStructuredInputSession(fields, () => false));
    act(() => {
      result.current.update("items", "[0]");
      result.current.reportPending("items", "导入", 1, true);
      expect(result.current.apply("items", nextText, 1)).toBe(false);
    });
    expect(result.current.values.items).toBe("[0]");
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.draftError).not.toBeNull();
  });

  it("单字段都合法但合计超容量的导入也不覆写、不截断，完整旧填写保留", () => {
    const { result } = renderHook(() => useStructuredInputSession(fields, () => false));
    const brief = "文".repeat(20000);
    const nextText = JSON.stringify(["料".repeat(20000)]);
    act(() => {
      result.current.update("items", "[0]");
      result.current.update("brief", brief);
      expect(result.current.apply("items", nextText, 1)).toBe(false);
    });
    expect(result.current.values.items).toBe("[0]");
    expect(result.current.values.brief).toBe(brief);
    expect(result.current.draftError).toContain("100 KB");
  });

  it("跨字段合计的数据项上限仍由原共享契约核对，不只检查导入单项", () => {
    const { result } = renderHook(() => useStructuredInputSession(fields, () => false));
    const details = JSON.stringify({ 子项: Array.from({ length: 1050 }, () => 0) });
    act(() => {
      result.current.update("details", details);
      expect(result.current.apply("items", JSON.stringify(Array.from({ length: 1050 }, () => false)), 0)).toBe(false);
    });
    expect(result.current.values.items).toBeUndefined();
    expect(result.current.values.details).toBe(details);
    expect(result.current.draftError).toContain("2000");
  });

  it("确认清空增加每项修订，不能让尚未返回的文件读入重新填写空表单", () => {
    const { result } = renderHook(() => useStructuredInputSession(fields, () => false));
    act(() => {
      result.current.update("items", "[0]");
      result.current.reportPending("items", "文件读取", 1, true);
      result.current.reset();
      expect(result.current.apply("items", "[99]", 1)).toBe(false);
      result.current.reportPending("items", "文件读取", 1, true);
    });
    expect(result.current.values).toEqual({});
    expect(result.current.revisions.items).toBe(2);
    expect(result.current.pendingCount).toBe(0);
  });

  it("卸载后保留的旧回调不改填写，新会话从空输入开始且严格模式可正常编辑", () => {
    const previous = renderHook(() => useStructuredInputSession(fields, () => false));
    const old = previous.result.current;
    previous.unmount();
    expect(old.update("items", "[99]")).toBe(false);
    expect(old.apply("items", "[99]", 0)).toBe(false);
    old.reportPending("items", "已卸载", 0, true);
    const current = renderHook(() => useStructuredInputSession(fields, () => false), { wrapper: StrictMode });
    act(() => current.result.current.update("items", "[0,false]"));
    expect(current.result.current.values.items).toBe("[0,false]");
    expect(current.result.current.pendingCount).toBe(0);
  });
});
