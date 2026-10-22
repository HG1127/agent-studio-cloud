"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { AgentInputField } from "@/contracts/manifest";
import { RunInputPayload } from "@/contracts/run";
import { prepareRunLauncherInput } from "@/features/agents/run-launcher-input";

export function useStructuredInputSession(fields: AgentInputField[], isLocked: () => boolean) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.create(null) as Record<string, string>);
  const [revisions, setRevisions] = useState<Record<string, number>>(() => Object.create(null) as Record<string, number>);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const valuesRef = useRef<Record<string, string>>(Object.create(null) as Record<string, string>);
  const revisionsRef = useRef<Record<string, number>>(Object.create(null) as Record<string, number>);
  const pendingRef = useRef(new Map<string, { owner: string; revision: number }>());
  const mounted = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function update(name: string, value: string) {
    if (!mounted.current || isLocked() || !fields.some((field) => field.name === name)) return false;
    valuesRef.current = Object.assign(Object.create(null) as Record<string, string>, valuesRef.current, { [name]: value });
    revisionsRef.current = Object.assign(Object.create(null) as Record<string, number>, revisionsRef.current, { [name]: (revisionsRef.current[name] ?? 0) + 1 });
    pendingRef.current.delete(name);
    setValues(valuesRef.current);
    setRevisions(revisionsRef.current);
    setPendingCount(pendingRef.current.size);
    setDraftError(null);
    setApplied(false);
    return true;
  }

  function apply(name: string, nextText: string, expectedRevision: number) {
    if (!mounted.current || isLocked() || (revisionsRef.current[name] ?? 0) !== expectedRevision) return false;
    const field = fields.find((item) => item.name === name);
    if (!field || (field.type !== "object" && field.type !== "array")) return false;
    let value: unknown;
    try { value = JSON.parse(nextText) as unknown; }
    catch { setDraftError("结构化填写暂时无法应用，请先核对数据格式；原填写仍保留。"); return false; }
    if (field.type === "array" ? !Array.isArray(value) : value === null || typeof value !== "object" || Array.isArray(value)) {
      setDraftError("结构化填写与本项要求的格式不同；原填写仍保留。");
      return false;
    }
    const single = RunInputPayload.safeParse({ [name]: value });
    if (!single.success) {
      setDraftError(`${single.error.issues[0]?.message ?? "数据结构无法读取"}；本次填写尚未应用，原填写仍保留。`);
      return false;
    }
    const next = { ...valuesRef.current, [name]: nextText };
    const prepared = prepareRunLauncherInput(fields.map((item) => ({ ...item, required: false })), next, "{}");
    if (!prepared.input) {
      setDraftError(`${prepared.error}；请核对当前各项格式及全部输入容量，本次填写尚未应用。`);
      return false;
    }
    const accepted = update(name, nextText);
    if (accepted) setApplied(true);
    return accepted;
  }

  function reportPending(name: string, owner: string, revision: number, pending: boolean) {
    if (!mounted.current || (revisionsRef.current[name] ?? 0) !== revision || !fields.some((field) => field.name === name)) return;
    if (pending) {
      if (isLocked()) return;
      const current = pendingRef.current.get(name);
      if (current && current.owner !== owner) return;
      pendingRef.current.set(name, { owner, revision });
      setApplied(false);
    } else {
      const current = pendingRef.current.get(name);
      if (current?.owner !== owner || current.revision !== revision) return;
      pendingRef.current.delete(name);
    }
    setPendingCount(pendingRef.current.size);
  }

  function firstPendingIndex() {
    const index = fields.findIndex((field) => pendingRef.current.has(field.name));
    return index < 0 ? null : index;
  }

  function reset() {
    if (!mounted.current || isLocked()) return;
    valuesRef.current = Object.create(null) as Record<string, string>;
    revisionsRef.current = Object.fromEntries(fields.map((field) => [field.name, (revisionsRef.current[field.name] ?? 0) + 1]));
    pendingRef.current.clear();
    setValues(valuesRef.current);
    setRevisions(revisionsRef.current);
    setPendingCount(0);
    setDraftError(null);
    setApplied(false);
  }

  return { values, revisions, valuesRef, draftError, applied, pendingCount, update, apply, reportPending, firstPendingIndex, reset };
}
