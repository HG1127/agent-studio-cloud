"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createAgentAction } from "@/server/actions/create-agent";
import { composeAgentBlueprintIntent, MAX_AGENT_INTENT_LENGTH } from "./agent-blueprint";

const INTENT_PLACEHOLDER =
  "收到客户咨询后读取客户资料并生成回复方案，发送前由负责人确认，最后输出回复邮件";

export function CreateAgentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [intentText, setIntentText] = useState("");
  const [trigger, setTrigger] = useState("");
  const [inputs, setInputs] = useState("");
  const [outputs, setOutputs] = useState("");
  const [constraints, setConstraints] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const blueprintIntent = composeAgentBlueprintIntent({
      objective: intentText,
      trigger,
      inputs,
      outputs,
      constraints,
    });
    if (blueprintIntent.length > MAX_AGENT_INTENT_LENGTH) {
      setError(`完整业务蓝图不能超过 ${MAX_AGENT_INTENT_LENGTH} 个字，请精简后重试`);
      return;
    }
    setPending(true);
    try {
      const result = await createAgentAction({ name, intentText: blueprintIntent });
      if (result.ok) {
        router.push(`/agents/${result.agentId}`);
        return;
      }
      setError(result.error);
    } catch {
      setError("创建请求失败，请检查网络后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="agent-name" className="text-sm font-medium">
          助手名称
        </label>
        <input
          id="agent-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          required
          disabled={pending}
          className="rounded-md border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none disabled:bg-gray-100"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="agent-intent" className="text-sm font-medium">
          想让助手完成什么（至少 10 个字）
        </label>
        <textarea
          id="agent-intent"
          value={intentText}
          onChange={(event) => setIntentText(event.target.value)}
          rows={4}
          minLength={10}
          maxLength={2000}
          required
          disabled={pending}
          placeholder={INTENT_PLACEHOLDER}
          className="rounded-md border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none disabled:bg-gray-100"
        />
      </div>
      <details className="rounded-md border border-gray-200 bg-gray-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-800">补充业务蓝图（推荐）</summary>
        <p className="mt-2 text-xs text-gray-500">信息越具体，生成的触发方式、运行输入和最终交付越准确。可先留空，创建后仍能在画布调整。</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">什么时候开始
            <input aria-label="什么时候开始" value={trigger} onChange={(event) => setTrigger(event.target.value)} maxLength={300}
              disabled={pending} placeholder="例如：收到新的售后工单后" className="rounded-md border border-gray-300 bg-white px-3 py-2 font-normal focus:border-gray-500 focus:outline-none disabled:bg-gray-100" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">需要哪些资料
            <input aria-label="需要哪些资料" value={inputs} onChange={(event) => setInputs(event.target.value)} maxLength={500}
              disabled={pending} placeholder="例如：工单内容、客户等级、商品信息" className="rounded-md border border-gray-300 bg-white px-3 py-2 font-normal focus:border-gray-500 focus:outline-none disabled:bg-gray-100" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">最终要交付什么
            <input aria-label="最终要交付什么" value={outputs} onChange={(event) => setOutputs(event.target.value)} maxLength={500}
              disabled={pending} placeholder="例如：回复邮件和处理记录" className="rounded-md border border-gray-300 bg-white px-3 py-2 font-normal focus:border-gray-500 focus:outline-none disabled:bg-gray-100" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">有哪些限制
            <input aria-label="有哪些限制" value={constraints} onChange={(event) => setConstraints(event.target.value)} maxLength={500}
              disabled={pending} placeholder="例如：发送前必须由负责人确认" className="rounded-md border border-gray-300 bg-white px-3 py-2 font-normal focus:border-gray-500 focus:outline-none disabled:bg-gray-100" />
          </label>
        </div>
      </details>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-400"
      >
        {pending ? "正在生成流程草稿…" : "创建助手"}
      </button>
    </form>
  );
}
