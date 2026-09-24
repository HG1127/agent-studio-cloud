"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createAgentAction } from "@/server/actions/create-agent";

const INTENT_PLACEHOLDER =
  "收到客户咨询后读取客户资料并生成回复方案，发送前由负责人确认，最后输出回复邮件";

export function CreateAgentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [intentText, setIntentText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await createAgentAction({ name, intentText });
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
