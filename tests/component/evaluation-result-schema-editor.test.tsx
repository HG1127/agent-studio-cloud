import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationResultSchemaEditor, EvaluationResultSchemaSummary } from "@/features/agents/EvaluationResultSchemaEditor";
import { changeResultSchema, resultSchemaSession, type ResultSchemaChange } from "@/features/agents/evaluation-result-schema-draft";

const schema = { type: "object", properties: { approved: { const: false }, amount: { minimum: 0 } } };
afterEach(() => vi.restoreAllMocks());
function Harness({ locked = false }: { locked?: boolean }) {
  const [session, setSession] = useState(() => resultSchemaSession(1, schema, true));
  const live = useRef(session);
  function change(request: ResultSchemaChange) {
    if (locked) return false;
    const next = changeResultSchema(live.current, request);
    if (!next) return false;
    live.current = next; setSession(next); return true;
  }
  return <><EvaluationResultSchemaEditor key={session.generation} session={session} locked={locked} creating={false} onChange={change} />
    <button onClick={() => { const next = resultSchemaSession(live.current.generation + 1, schema, true); live.current = next; setSession(next); }}>重新打开同样例</button></>;
}
describe("结果结构规则编辑叶子", () => {
  it.each([undefined, null, [], schema])("只读来源%j不写入、不补规则", (value) => {
    const before = JSON.stringify(value), storage = vi.spyOn(Storage.prototype, "setItem"), fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<EvaluationResultSchemaSummary value={value} supplied={value !== undefined} />);
    expect(screen.getByRole("region", { name: "已保存的结果结构规则" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(storage).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled(); expect(JSON.stringify(value)).toBe(before);
  });
  it("新样例编辑为空，不默默生成示例", () => {
    const onChange = vi.fn();
    render(<EvaluationResultSchemaEditor session={resultSchemaSession(1)} locked={false} creating onChange={onChange} />);
    expect(screen.getByText(/不会自动生成示例/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑结果结构规则" }));
    expect(onChange).toHaveBeenCalledWith({ generation: 1, revision: 0, operation: { kind: "begin" } });
  });
  it("取消弹窗返回保留填写，明确取消才恢复原规则", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "编辑结果结构规则" }));
    fireEvent.change(screen.getByLabelText("结果结构规则（开发者格式）"), { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "取消规则填写" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toHaveValue("{");
    fireEvent.click(screen.getByRole("button", { name: "取消规则填写" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认取消规则填写" }));
    expect(screen.queryByLabelText("结果结构规则（开发者格式）")).not.toBeInTheDocument();
    expect(screen.getByText(/已保存结果结构规则/)).toBeInTheDocument();
  });
  it("同批A到B再回A让原清除确认失效", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "编辑结果结构规则" }));
    fireEvent.click(screen.getByRole("button", { name: "明确清除结构规则" }));
    const textarea = screen.getByLabelText("结果结构规则（开发者格式）");
    act(() => {
      fireEvent.change(textarea, { target: { value: '{"type":"object","description":"B"}' } });
      fireEvent.change(textarea, { target: { value: JSON.stringify(schema, null, 2) } });
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认清除结构规则" }));
    });
    expect(textarea).toHaveValue(JSON.stringify(schema, null, 2));
    expect(screen.getByRole("alert")).toHaveTextContent("本次操作未接收");
    expect(screen.queryByText(/本次保存将明确清除/)).not.toBeInTheDocument();
  });
  it("重新打开同样例会关闭旧确认，不复活本页编辑", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "明确清除结构规则" }));
    fireEvent.click(screen.getByRole("button", { name: "重新打开同样例" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/本次保存将明确清除/)).not.toBeInTheDocument();
  });
  it("锁定时确认和所有编辑入口都不接受操作", () => {
    const onChange = vi.fn();
    const initial = resultSchemaSession(1, schema, true);
    render(<EvaluationResultSchemaEditor session={initial} locked creating={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑结果结构规则" }));
    fireEvent.click(screen.getByRole("button", { name: "明确清除结构规则" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
