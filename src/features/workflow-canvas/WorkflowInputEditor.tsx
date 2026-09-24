import type { WorkflowVariable } from "@/contracts/workflow";

const FIELD_TYPES = [
  ["string", "文字"],
  ["number", "数字"],
  ["boolean", "是或否"],
  ["object", "对象"],
  ["array", "列表"],
] as const;

export function WorkflowInputEditor({ variables, onChange }: {
  variables: WorkflowVariable[];
  onChange: (variables: WorkflowVariable[]) => void;
}) {
  function update(index: number, patch: Partial<WorkflowVariable>) {
    onChange(variables.map((variable, position) => position === index ? { ...variable, ...patch } : variable));
  }
  function add() {
    let index = variables.length + 1;
    while (variables.some((variable) => variable.name === `field_${index}`)) index += 1;
    onChange([...variables, { name: `field_${index}`, label: "新输入字段", type: "string", scope: "run", required: true }]);
  }
  return (
    <details className="rounded-lg border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold">运行输入字段（{variables.length || "默认"}）</summary>
      <p className="mt-2 text-xs text-gray-500">定义员工运行助手时需要填写的内容。未设置时使用一个“业务输入”文本框。</p>
      {variables.length > 0 ? <div className="mt-3 space-y-3">
        {variables.map((variable, index) => (
          <div key={index} className="grid gap-2 rounded-md border border-gray-100 p-3 md:grid-cols-[1fr_1fr_120px_auto_auto]">
            <label className="flex flex-col gap-1 text-xs text-gray-600">字段名
              <input aria-label={`字段 ${index + 1} 名称`} value={variable.name}
                onChange={(event) => {
                  const cleaned = event.target.value.replace(/[^A-Za-z0-9_]/g, "");
                  update(index, { name: /^\d/.test(cleaned) ? `_${cleaned}` : cleaned });
                }}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600">显示名称
              <input aria-label={`字段 ${index + 1} 显示名称`} value={variable.label ?? ""}
                onChange={(event) => update(index, { label: event.target.value })}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600">内容类型
              <select aria-label={`字段 ${index + 1} 类型`} value={variable.type}
                onChange={(event) => update(index, { type: event.target.value })}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                {FIELD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end py-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={variable.required} onChange={(event) => update(index, { required: event.target.checked })} />必填
            </label>
            <button type="button" onClick={() => onChange(variables.filter((_, position) => position !== index))}
              className="self-end py-1.5 text-xs text-red-600 hover:underline">删除</button>
          </div>
        ))}
      </div> : null}
      <button type="button" onClick={add} className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:border-gray-500">添加输入字段</button>
    </details>
  );
}
