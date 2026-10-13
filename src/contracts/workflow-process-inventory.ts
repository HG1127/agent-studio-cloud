import { z } from "zod";
import { WorkflowAcceptanceContext } from "./workflow-case-acceptance";
import { MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES } from "./workflow-acceptance-bridge";

export const MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES = 256 * 1024;
const Timestamp = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const UInt32 = z.number().int().min(0).max(0xffffffff);
const ProcessId = UInt32.min(1);
const ImagePath = z.string().min(4).max(2048).refine((value) => {
  if (!/^[a-z]:\\/i.test(value) || /[\x00-\x1f\x7f/"<>|?*]/.test(value)) return false;
  return value.slice(3).split("\\").every((part) => part && ![".", ".."].includes(part)
    && !part.includes(":") && !/[. ]$/.test(part));
}, "镜像路径必须是规范化的本地 Windows 绝对路径");
const ImageFields = {
  imagePath: ImagePath, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().positive().max(256 * 1024 * 1024),
  volumeSerialNumber: UInt32, fileIndex: z.string().regex(/^[a-f0-9]{16}$/),
};
export const WorkflowAcceptanceExecutablePin = z.object({ ...ImageFields, pinnedAt: Timestamp }).strict();
export type WorkflowAcceptanceExecutablePin = z.infer<typeof WorkflowAcceptanceExecutablePin>;
export const WorkflowAcceptanceProcessImage = z.object({
  ...ImageFields, kind: z.enum(["node", "esbuild"]), observedAt: Timestamp,
}).strict();
export type WorkflowAcceptanceProcessImage = z.infer<typeof WorkflowAcceptanceProcessImage>;
export const WorkflowAcceptanceProcessMember = z.object({
  processId: ProcessId, imageObservationStatus: z.enum(["observed", "unknown"]),
  image: WorkflowAcceptanceProcessImage.nullable(), exitCode: UInt32.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.imageObservationStatus === "observed") !== (value.image !== null)) {
    context.addIssue({ code: "custom", message: "未识别的镜像不能声明类别或文件身份" });
  }
});
export type WorkflowAcceptanceProcessMember = z.infer<typeof WorkflowAcceptanceProcessMember>;

function sameImage(image: WorkflowAcceptanceProcessImage, pin: WorkflowAcceptanceExecutablePin): boolean {
  return image.imagePath.toLowerCase() === pin.imagePath.toLowerCase() && image.sha256 === pin.sha256
    && image.byteLength === pin.byteLength && image.volumeSerialNumber === pin.volumeSerialNumber && image.fileIndex === pin.fileIndex;
}

function passiveMirror(value: unknown): unknown {
  const maximum = MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES;
  const encoder = new TextEncoder();
  const ancestors = new Set<object>();
  let bytes = 0, entries = 0;
  function copy(item: unknown, depth = 0): unknown {
    if (++entries > 4096 || depth > 16) throw new Error("oversized data");
    if (item === null || typeof item !== "object") {
      if (item !== null && typeof item !== "string" && typeof item !== "boolean" && (typeof item !== "number" || !Number.isFinite(item))) throw new Error("invalid primitive");
      bytes += encoder.encode(JSON.stringify(item)).byteLength;
      if (bytes > maximum) throw new Error("oversized data");
      return item;
    }
    if (ancestors.has(item)) throw new Error("cyclic data");
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array || prototype !== null) {
      if (!prototype || (array ? !Array.isArray(prototype) : Object.getPrototypeOf(prototype) !== null)) throw new Error("invalid prototype");
      const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
      if (!constructor || !Object.hasOwn(constructor, "value") || typeof constructor.value !== "function") throw new Error("invalid constructor");
      const ownedPrototype = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
      if (!ownedPrototype || !Object.hasOwn(ownedPrototype, "value") || ownedPrototype.value !== prototype
        || Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(array ? Array : Object)) throw new Error("invalid constructor");
    }
    const ownKeys = Reflect.ownKeys(item);
    if (ownKeys.length > 4097 || ownKeys.some((name) => typeof name !== "string")) throw new Error("invalid keys");
    const keys = (ownKeys as string[]).filter((name) => !(array && name === "length"));
    const length = array ? Object.getOwnPropertyDescriptor(item, "length")?.value as number : 0;
    if (array && (keys.length !== length || keys.some((name) => !/^(?:0|[1-9]\d*)$/.test(name) || Number(name) >= length))) throw new Error("invalid array");
    bytes += 2 + Math.max(0, keys.length - 1);
    const target = array ? [] : Object.create(null);
    ancestors.add(item);
    for (const name of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, name);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("invalid property");
      if (!array) bytes += encoder.encode(JSON.stringify(name)).byteLength + 1;
      if (bytes > maximum) throw new Error("oversized data");
      Object.defineProperty(target, name, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(item);
    if (bytes > maximum) throw new Error("oversized data");
    return target;
  }
  return copy(value);
}

const InventoryBody = z.object({
  version: z.literal(1), context: WorkflowAcceptanceContext, phase: z.enum(["business", "bridge", "migration"]),
  rootProcessId: ProcessId, startedAt: Timestamp, stoppedAt: Timestamp.nullable(),
  expectedImages: z.object({ node: WorkflowAcceptanceExecutablePin, esbuild: WorkflowAcceptanceExecutablePin }).strict(),
  members: z.array(WorkflowAcceptanceProcessMember).min(1).max(MAX_WORKFLOW_ACCEPTANCE_OWNED_PROCESSES),
  totalProcesses: ProcessId.nullable(), remainingOwnedProcesses: UInt32.nullable(),
  inventoryComplete: z.boolean(), stdoutEof: z.boolean(), stderrEof: z.boolean(),
  termination: z.enum(["natural", "forced", "unknown"]), observationStatus: z.enum(["observed", "unknown"]),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const started = Date.parse(value.startedAt), stopped = value.stoppedAt === null ? null : Date.parse(value.stoppedAt);
  if (stopped !== null && stopped < started) issue("结束时间不能早于启动时间");
  const pins = value.expectedImages;
  for (const kind of ["node", "esbuild"] as const) {
    if (Date.parse(pins[kind].pinnedAt) > started || pins[kind].imagePath.split("\\").at(-1)?.toLowerCase() !== `${kind}.exe`) {
      issue("镜像必须在启动前固定且符合唯一运行类别");
    }
  }
  if (pins.node.imagePath.toLowerCase() === pins.esbuild.imagePath.toLowerCase()
    || pins.node.volumeSerialNumber === pins.esbuild.volumeSerialNumber && pins.node.fileIndex === pins.esbuild.fileIndex) {
    issue("两个运行类别不能指向同一镜像身份");
  }
  const ids = new Set(value.members.map((member) => member.processId));
  const root = value.members.find((member) => member.processId === value.rootProcessId);
  if (ids.size !== value.members.length || !root || root.image !== null && root.image.kind !== "node") issue("全量进程清单必须唯一且包含 Node 根进程");
  for (const member of value.members) {
    if (member.image !== null) {
      if (!sameImage(member.image, pins[member.image.kind])) issue("实际镜像身份必须与父启动前固定的镜像一致");
      const observed = Date.parse(member.image.observedAt);
      if (observed < started || stopped !== null && observed > stopped) issue("镜像观察必须属于本次进程生命周期");
    }
  }
  if (value.inventoryComplete && (value.totalProcesses !== value.members.length || value.remainingOwnedProcesses !== 0
    || value.members.some((member) => member.exitCode !== 0))) issue("完整 Job 清单必须匹配真实总数及逐成员零退出");
  const closed = value.inventoryComplete && value.totalProcesses === value.members.length && value.remainingOwnedProcesses === 0
    && stopped !== null && value.stdoutEof && value.stderrEof && value.termination === "natural"
    && !!root && root.image?.kind === "node" && value.members.every((member) => member.imageObservationStatus === "observed" && member.image !== null && member.exitCode === 0);
  if ((value.observationStatus === "observed") !== closed) issue("完整观察必须同时具有全部镜像、自然零退出及父双流结束事实");
});

// 这里只校验父观察事实的格式与一致性，不授予执行、数据库写入或清理许可。
export const WorkflowAcceptanceProcessInventory = z.preprocess((value, context) => {
  try { return passiveMirror(value); }
  catch { context.addIssue({ code: "custom", message: "进程清单只能包含有界被动数据" }); return z.NEVER; }
}, InventoryBody);
export type WorkflowAcceptanceProcessInventory = z.infer<typeof WorkflowAcceptanceProcessInventory>;
