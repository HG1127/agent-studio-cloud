"use client";

import { createContext, useState } from "react";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import { inlineStepId } from "./inline-step-editing";
import type { NodeContractField } from "./node-contract-editing";
import type { MappingEdit } from "./node-input-mapping-editing";
import type { ModelOutputEditorDraft } from "./node-model-output-editing";
import type { ToolOperationEditorDraft } from "./node-tool-operation-editing";
import type { AiReworkEdit } from "./ai-rework-editing";
import type { QualityGateRulesEdit } from "./quality-gate-rules-editing";

export type ContractIdentity = { parentId: string; branchId?: string; stepId?: string };
export type ModelContractEdit = { snapshot: string; draft: ModelOutputEditorDraft };
export type ToolContractEdit = { snapshot: string; draft: ToolOperationEditorDraft };
type Values = { inputMapping: MappingEdit; modelOutput: ModelContractEdit; toolOperation: ToolContractEdit; retry: AiReworkEdit; quality: QualityGateRulesEdit };
export type ContractEditEntry<T> = { value: T; epoch: number; revision: number; generation: number; dirty: boolean };
export type ContractEditorMemory<T> = { epoch: number; entry?: ContractEditEntry<T>; change: (value: T) => void; discard: () => void };
export type ContractCommit = {
  identity: ContractIdentity; field: NodeContractField; node: WorkflowNode; expectedNode: WorkflowNode;
  expectedParent: WorkflowNode; epoch: number; generation: number; revision: number;
};
type StoredEntry = ContractEditEntry<Values[NodeContractField]> & { owner: string; field: NodeContractField };
type Owner = { type: string; fallback?: string };

export function contractIdentityKey(identity: ContractIdentity) {
  return JSON.stringify([identity.parentId, identity.branchId ?? null, identity.stepId ?? null]);
}

function ownersIn(draft: WorkflowDraft) {
  const owners = new Map<string, Owner>();
  for (const node of Object.values(draft.nodes)) {
    owners.set(contractIdentityKey({ parentId: node.id }), { type: node.type });
    const groups = node.type === "subflow" ? [{ branchId: undefined, steps: node.subflow?.steps ?? [] }]
      : node.type === "parallel" ? (node.parallel?.branches ?? []).map((branch) => ({ branchId: branch.id, steps: branch.steps })) : [];
    for (const group of groups) {
      const ids = group.steps.map(inlineStepId);
      group.steps.forEach((step, index) => {
        if (ids.filter((id) => id === ids[index]).length !== 1) return;
        const details = { ...step };
        delete details.id; delete details.inputMapping; delete details.modelOutput; delete details.toolOperation; delete details.retry;
        owners.set(contractIdentityKey({ parentId: node.id, branchId: group.branchId, stepId: ids[index] }), {
          type: String(step.type), fallback: step.id ? undefined : JSON.stringify(details),
        });
      });
    }
  }
  return owners;
}

export class NodeContractEditStore {
  epoch = 0;
  private scope = "";
  private snapshot = "";
  private revision = 0;
  private owners = new Map<string, Owner>();
  private generations = new Map<string, number>();
  private entries = new Map<string, StoredEntry>();

  observe(scope: string, draft: WorkflowDraft, tools: readonly ToolRegistryOption[] = []) {
    const snapshot = JSON.stringify([draft, tools]);
    if (scope === this.scope && snapshot === this.snapshot) return;
    if (scope !== this.scope) { this.entries.clear(); this.owners.clear(); this.generations.clear(); }
    this.scope = scope; this.snapshot = snapshot; this.epoch += 1;
    for (const [key, entry] of this.entries) if (!entry.dirty) this.entries.delete(key);
    const next = ownersIn(draft);
    for (const [key, previous] of this.owners) {
      const current = next.get(key);
      if (!current || current.type !== previous.type) {
        for (const [entryKey, entry] of this.entries) if (entry.owner === key) this.entries.delete(entryKey);
        this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
      } else if (previous.fallback && current.fallback && previous.fallback !== current.fallback) {
        // 无稳定标识的旧步骤发生变化时保留孤立填写，禁止套用到相同位置的新步骤。
        this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
      }
    }
    for (const key of next.keys()) if (!this.generations.has(key)) this.generations.set(key, 1);
    this.owners = next;
  }

  generation(identity: ContractIdentity) { return this.generations.get(contractIdentityKey(identity)) ?? 0; }
  private key(identity: ContractIdentity, field: NodeContractField) {
    return JSON.stringify([contractIdentityKey(identity), this.generation(identity), field]);
  }
  read<K extends NodeContractField>(identity: ContractIdentity, field: K): ContractEditEntry<Values[K]> | undefined {
    return this.entries.get(this.key(identity, field)) as ContractEditEntry<Values[K]> | undefined;
  }
  write<K extends NodeContractField>(identity: ContractIdentity, field: K, value: Values[K], dirty: boolean) {
    const owner = contractIdentityKey(identity);
    if (!this.owners.has(owner)) return;
    const previous = this.entries.get(this.key(identity, field));
    this.entries.set(this.key(identity, field), { owner, field, value, dirty, epoch: previous?.epoch ?? this.epoch,
      revision: ++this.revision, generation: this.generation(identity) });
  }
  clear(identity: ContractIdentity, field: NodeContractField, revision?: number) {
    const key = this.key(identity, field), entry = this.entries.get(key);
    if (revision === undefined || entry?.revision === revision) this.entries.delete(key);
  }
  accepts(request: ContractCommit) {
    const entry = this.read(request.identity, request.field);
    return this.owners.has(contractIdentityKey(request.identity)) && request.epoch === this.epoch
      && request.generation === this.generation(request.identity)
      && request.revision === (entry?.revision ?? 0) && (!entry || entry.epoch === this.epoch);
  }
  reset() { this.entries.clear(); this.epoch += 1; }
  get pendingCount() { return [...this.entries.values()].filter((entry) => entry.dirty).length; }
}

export function useNodeContractEdits(scope: string, draft: WorkflowDraft, tools: readonly ToolRegistryOption[] = []) {
  const [store] = useState(() => new NodeContractEditStore());
  store.observe(scope, draft, tools);
  const [, setVersion] = useState(0);
  return { store, epoch: store.epoch, pendingCount: store.pendingCount, refresh: () => setVersion((value) => value + 1) };
}

export const NodeContractEditContext = createContext<(ReturnType<typeof useNodeContractEdits> & {
  commit: (request: ContractCommit) => boolean;
}) | null>(null);
