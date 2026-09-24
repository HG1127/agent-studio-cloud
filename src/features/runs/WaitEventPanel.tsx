"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { WaitEventPayload, WaitEventResumeResult } from "@/contracts/run";

export function WaitEventPanel({ runId, eventKey, title }: { runId: string; eventKey: string; title: string }) {
  const router = useRouter();
  const [content, setContent] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="rounded-lg border border-cyan-200 bg-cyan-50 p-4">
      <h2 className="text-sm font-semibold text-cyan-900">提交继续消息</h2>
      <p className="mt-1 text-sm text-cyan-800">{title}</p>
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setNotice(null);
          let raw: unknown;
          try {
            raw = JSON.parse(content);
          } catch {
            setError("消息内容格式不正确，请填写一个对象");
            return;
          }
          const payload = WaitEventPayload.safeParse(raw);
          if (!payload.success) {
            setError("消息内容需要是一个对象，不能是文字或列表");
            return;
          }
          startTransition(async () => {
            try {
              const response = await fetch(`/api/runs/${runId}/events/${encodeURIComponent(eventKey)}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload.data),
              });
              const result = WaitEventResumeResult.safeParse(await response.json());
              if (!result.success) {
                setError("消息提交结果无法读取，请刷新页面确认运行状态");
                return;
              }
              if (!result.data.ok) {
                setError(result.data.error);
                return;
              }
              setNotice("消息已提交，运行将继续");
              router.refresh();
            } catch {
              setError("消息提交失败，请检查网络后重试");
            }
          });
        }}
      >
        <label htmlFor="wait-event-content" className="text-sm font-medium text-cyan-900">消息内容</label>
        <textarea
          id="wait-event-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={4}
          spellCheck={false}
          className="rounded-md border border-cyan-200 bg-white px-3 py-2 font-mono text-sm text-gray-800"
        />
        <p className="text-xs text-cyan-700">示例：{`{"complete": true, "note": "资料已补齐"}`}</p>
        <button type="submit" disabled={pending} className="w-fit rounded-md bg-cyan-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? "提交中…" : "提交并继续"}
        </button>
      </form>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="mt-2 text-sm text-emerald-700">{notice}</p> : null}
    </section>
  );
}
