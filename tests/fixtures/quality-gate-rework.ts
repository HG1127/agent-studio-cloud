export function qualityGateReworkDraft() {
  return {
    id: "quality-rework", startNodeId: "start",
    rootAgent: { id: "00000000-0000-4000-8000-0000000000c1", name: "方案助手", role: "整理方案" },
    memoryPolicy: { taskContext: true, longTerm: false },
    originalRoot: { zero: 0, no: false, empty: null },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "writer-private" },
      "writer-private": {
        id: "writer-private", title: "生成方案", type: "ai", next: "review-private",
        retry: { maxAttempts: 2, backoffMs: 500, originalRetry: { keep: [0, false, null] } },
        originalNode: { keep: "原内容" },
      },
      "review-private": {
        id: "review-private", title: "核对交付", type: "rule", next: "done", rule: { kind: "quality_review" },
        quality: { requiredOutputTitles: ["生成方案"], minOutputCount: 1, checkToolReceipts: true, checkHumanBoundary: true },
      },
      done: { id: "done", title: "完成", type: "end", next: null },
    },
  };
}
