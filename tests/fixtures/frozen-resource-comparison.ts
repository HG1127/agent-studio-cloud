import type { FrozenResourceBindingsView } from "@/features/versions/frozen-resource-bindings";

export function beforeFrozenResourceView(): FrozenResourceBindingsView {
  return {
    state: "available",
    notice: "仅核对这个版本原快照中的声明和引用；未检查历史权限、连接配置、资源内容或当前可用性。",
    model: {
      selection: "原快照保存了模型选择标识；历史模型名称未保存。",
      mock: "模拟模式原字段未保存；契约默认未启用模拟模式。",
      connection: "连接原字段未保存；契约默认未指定已保存连接。",
    },
    knowledge: {
      description: "原快照未保存资料声明列表；契约默认空列表，不能当作历史明确选择了 0 项。",
      items: [],
    },
    tools: "当前版本契约未保存工具目录快照，无法核对历史工具名称、定义和权限；仅展示步骤中保存的引用声明。",
    steps: [{
      name: "核对办理资料",
      context: "顶层步骤",
      bindings: [{ kind: "资料", details: ["原步骤未保存资料引用列表，绑定范围未知。"] }],
      warnings: [],
      ownerNodeId: "comparison_owner_before",
    }],
    unknownFieldCount: 0,
    warnings: [],
  };
}

export function afterFrozenResourceView(): FrozenResourceBindingsView {
  return {
    state: "available",
    notice: "仅核对这个版本原快照中的声明和引用；未检查历史权限、连接配置、资源内容或当前可用性。",
    model: {
      selection: "原快照保存了模型选择标识；历史模型名称未保存。",
      mock: "原字段记录：未启用模拟模式。",
      connection: "连接原字段明确未指定已保存连接。",
    },
    knowledge: {
      description: "原快照明确保存了 0 项资料声明；历史资料名称和内容未保存。",
      items: [],
    },
    tools: "当前版本契约未保存工具目录快照，无法核对历史工具名称、定义和权限；仅展示步骤中保存的引用声明。",
    steps: [{
      name: "核对办理资料",
      context: "顶层步骤",
      bindings: [{ kind: "资料", details: ["原步骤明确保存了 0 项资料引用。", "原字段记录：不要求选择资料。"] }],
      warnings: [],
      ownerNodeId: "comparison_owner_after",
    }],
    unknownFieldCount: 0,
    warnings: [],
  };
}

export function unknownFrozenResourceView(): FrozenResourceBindingsView {
  return {
    state: "unknown",
    notice: "尚未确认拿到这个版本的完整原快照，资源声明和绑定范围未知。",
    model: null,
    knowledge: null,
    tools: "原快照无法完整核对，工具声明范围未知。",
    steps: [],
    unknownFieldCount: null,
    warnings: [],
  };
}
