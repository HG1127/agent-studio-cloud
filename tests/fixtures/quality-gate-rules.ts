export function qualityGateRulesDraft() {
  return {
    id: "quality-rules", startNodeId: "start",
    rootAgent: { id: "00000000-0000-4000-8000-0000000000d1", name: "方案核对助手", role: "核对交付" },
    memoryPolicy: { taskContext: true, longTerm: false },
    originalRoot: { zero: 0, no: false, empty: null },
    nodes: {
      start: { id: "start", type: "trigger", title: "开始", next: "writer-private" },
      "writer-private": { id: "writer-private", type: "ai", title: "生成方案", next: "review-private", retry: { maxAttempts: 3, backoffMs: 750 }, untouched: { keep: [0, false, null] } },
      "reference-private": { id: "reference-private", type: "knowledge", title: "参考资料", next: "review-private" },
      "human-private": { id: "human-private", type: "human", title: "人工核对", next: "review-private" },
      "group-private": { id: "group-private", type: "subflow", title: "汇总工作", next: "review-private", subflow: { name: "汇总", steps: [{ id: "nested-private", type: "ai", title: "组内整理" }] } },
      "review-private": {
        id: "review-private", type: "rule", title: "核对交付", next: "done", rule: { kind: "quality_review", untouched: false },
        retry: { maxAttempts: 2, backoffMs: 500, untouched: [0, false, null] },
        quality: { requiredOutputTitles: ["生成方案"], minOutputCount: 1, checkToolReceipts: true, checkHumanBoundary: true, untouched: { keep: [0, false, null] } },
        untouched: { keep: "其他规则原样保留" },
      },
      done: { id: "done", type: "end", title: "完成", next: null },
    },
  };
}

export function removableQualityGateRulesDraft() {
  const base = qualityGateRulesDraft();
  return {
    ...base,
    nodes: {
      ...base.nodes,
      "review-private": {
        ...base.nodes["review-private"],
        rule: { ...base.nodes["review-private"].rule, kind: "business_rule" },
        quality: { requiredOutputTitles: ["生成方案"], minOutputCount: 1, checkToolReceipts: true, checkHumanBoundary: true },
      },
    },
  };
}
