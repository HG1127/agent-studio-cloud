import { MAX_WORKFLOW_OUTPUT_FIELDS, type WorkflowDraft, type WorkflowNode } from "@/contracts/workflow";

type OutputField = NonNullable<WorkflowDraft["outputContract"]>["fields"][number];

export function WorkflowOutputEditor({ nodes, fields, onChange }: {
  nodes: Record<string, WorkflowNode>;
  fields: OutputField[];
  onChange: (fields: OutputField[]) => void;
}) {
  const candidates = Object.values(nodes).filter((node) =>
    node.type !== "trigger" && node.type !== "end" && node.ui?.visibility !== "control",
  );
  function update(index: number, patch: Partial<OutputField>) {
    onChange(fields.map((field, position) => position === index ? { ...field, ...patch } : field));
  }
  function add() {
    if (fields.length >= MAX_WORKFLOW_OUTPUT_FIELDS) return;
    const source = candidates.find((node) => !fields.some((field) => field.sourceNodeId === node.id)) ?? candidates[0];
    if (!source) return;
    onChange([...fields, { path: source.id, label: source.title, required: true, sourceNodeId: source.id }]);
  }
  return (
    <details className="rounded-lg border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold">最终交付字段（{fields.length}）</summary>
      <p className="mt-2 text-xs text-gray-500">选择流程步骤的结果作为本助手对员工或其他助手交付的内容。</p>
      {fields.length > 0 ? <div className="mt-3 space-y-3">
        {fields.map((field, index) => (
          <div key={index} className="grid gap-2 rounded-md border border-gray-100 p-3 md:grid-cols-[1.5fr_1fr_1fr_auto_auto]">
            <label className="flex flex-col gap-1 text-xs text-gray-600">来源步骤
              <select aria-label={`交付字段 ${index + 1} 来源`} value={field.sourceNodeId ?? field.path}
                onChange={(event) => {
                  const source = nodes[event.target.value];
                  update(index, { sourceNodeId: event.target.value, label: field.label || source?.title });
                }} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                {!candidates.some((node) => node.id === (field.sourceNodeId ?? field.path))
                  ? <option value={field.sourceNodeId ?? field.path}>来源已不可用</option> : null}
                {candidates.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600">结果字段位置
              <input aria-label={`交付字段 ${index + 1} 位置`} value={field.path} placeholder="交付.方案"
                maxLength={200}
                onChange={(event) => update(index, { path: event.target.value })}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-600">显示名称
              <input aria-label={`交付字段 ${index + 1} 显示名称`} value={field.label ?? ""}
                maxLength={200}
                onChange={(event) => update(index, { label: event.target.value })}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="flex items-center gap-2 self-end py-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} />必需
            </label>
            <button type="button" onClick={() => onChange(fields.filter((_, position) => position !== index))}
              className="self-end py-1.5 text-xs text-red-600 hover:underline">删除</button>
          </div>
        ))}
      </div> : null}
      {fields.length >= MAX_WORKFLOW_OUTPUT_FIELDS
        ? <p className="mt-3 text-xs text-amber-700">最终交付字段已达到 {MAX_WORKFLOW_OUTPUT_FIELDS} 项上限。</p>
        : null}
      <button type="button" disabled={candidates.length === 0 || fields.length >= MAX_WORKFLOW_OUTPUT_FIELDS} onClick={add}
        className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:border-gray-500 disabled:text-gray-400">添加交付字段</button>
    </details>
  );
}
