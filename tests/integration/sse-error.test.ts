import { describe, expect, it, vi } from "vitest";

const runRow = { id: "00000000-0000-4000-8000-0000000000f5", status: "running" };
let calls = 0;

vi.mock("@/server/queries/trace", () => ({
  listTraceSince: vi.fn(async () => {
    calls += 1;
    if (calls >= 2) throw new Error("ECONNRESET: 连接被重置");
    return [];
  }),
}));
vi.mock("@/server/queries/runs", () => ({
  getRunRow: vi.fn(async () => runRow),
}));

import { GET as eventsGet } from "@/app/api/runs/[runId]/events/route";

describe("SSE 轮询异常关流", () => {
  it("DB 异常时先发 done(status:error) 再关流，客户端不会无限重连", async () => {
    const runId = "00000000-0000-4000-8000-0000000000f5";
    const request = new Request(`http://localhost/api/runs/${runId}/events`);
    const response = await eventsGet(request, { params: Promise.resolve({ runId }) });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    for (;;) {
      const { done, value } = await reader.read();
      received += decoder.decode(value ?? new Uint8Array());
      if (done || received.includes("done")) break;
    }
    expect(received).toContain("event: done");
    expect(received).toContain('"status":"error"');
  }, 60_000);
});
