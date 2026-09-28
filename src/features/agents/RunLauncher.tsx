"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { AgentInputField } from "@/contracts/manifest";
import { startRunAction } from "@/server/actions/start-run";

// 运行入口：输入 JSON 文本域（默认 {}）→ startRunAction → 跳转运行详情。
// 非法 JSON 前端拦截并提示中文错误，不发请求；启动失败展示动作返回的中文错误。
export function RunLauncher({ agentId, inputFields }: { agentId: string; inputFields?: AgentInputField[] }) {
  const router = useRouter();
  const [inputText, setInputText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const runningRef = useRef(false);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const usesFieldForm = Boolean(inputFields?.length);

  function parseInput(): Record<string, unknown> | null {
    if (usesFieldForm && inputFields) {
      const input: Record<string, unknown> = {};
      for (const field of inputFields) {
        const raw = fieldValues[field.name] ?? "";
        if (!raw.trim()) {
          if (field.required) setError(`请填写${field.label ?? field.name}`);
          if (field.required) return null;
          continue;
        }
        if (field.type === "number") {
          const value = Number(raw);
          if (!Number.isFinite(value)) {
            setError(`${field.label ?? field.name}必须是数字`);
            return null;
          }
          input[field.name] = value;
        } else if (field.type === "boolean") {
          input[field.name] = raw === "true";
        } else if (field.type === "object" || field.type === "array") {
          try {
            const value = JSON.parse(raw) as unknown;
            if (field.type === "array" ? !Array.isArray(value) : !value || typeof value !== "object" || Array.isArray(value)) throw new Error();
            input[field.name] = value;
          } catch {
            setError(`${field.label ?? field.name}的格式不正确`);
            return null;
          }
        } else {
          input[field.name] = raw;
        }
      }
      return input;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(inputText);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  }

  async function handleRun() {
    if (runningRef.current) return;
    setError(null);
    const input = parseInput();
    if (!input) {
      if (!usesFieldForm) setError("请输入正确的 JSON 格式");
      return;
    }
    runningRef.current = true;
    const fingerprint = JSON.stringify(input);
    const request = requestRef.current?.fingerprint === fingerprint
      ? requestRef.current
      : { fingerprint, id: crypto.randomUUID() };
    requestRef.current = request;
    setPending(true);
    try {
      const result = await startRunAction({ agentId, input, requestId: request.id });
      if (result.ok || !result.retryable) requestRef.current = null;
      if (result.ok) router.push(`/runs/${result.runId}`);
      else setError(result.error);
    } catch {
      setError("启动失败，请检查网络后重试");
    } finally {
      runningRef.current = false;
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      {usesFieldForm ? inputFields!.map((field) => (
        <label key={field.name} className="flex flex-col gap-1 text-sm text-gray-700">
          {field.label ?? field.name}{field.required ? "（必填）" : "（选填）"}
          {field.type === "boolean" ? (
            <select value={fieldValues[field.name] ?? ""} onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))}
              className="rounded-md border border-gray-300 bg-white p-2 text-sm">
              <option value="">请选择</option><option value="true">是</option><option value="false">否</option>
            </select>
          ) : field.type === "object" || field.type === "array" ? (
            <textarea value={fieldValues[field.name] ?? ""} rows={3} placeholder={field.type === "array" ? "[]" : "{}"}
              onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))}
              className="rounded-md border border-gray-300 bg-white p-2 font-mono text-sm" />
          ) : (
            <input type={field.type === "number" ? "number" : "text"} value={fieldValues[field.name] ?? ""}
              onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))}
              className="rounded-md border border-gray-300 bg-white p-2 text-sm" />
          )}
        </label>
      )) : (
        <label className="flex flex-col gap-1 text-sm text-gray-700">
          运行输入（JSON）
          <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} rows={4}
            className="rounded-md border border-gray-300 bg-white p-2 font-mono text-sm" />
        </label>
      )}
      {error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
        </div>
      ) : null}
      <button
        type="button"
        onClick={handleRun}
        disabled={pending}
        className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-400"
      >
        {pending ? "正在启动…" : "运行此助手"}
      </button>
    </section>
  );
}
