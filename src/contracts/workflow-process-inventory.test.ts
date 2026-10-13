import { describe, expect, it, vi } from "vitest";
import { MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES, WorkflowAcceptanceExecutablePin, WorkflowAcceptanceProcessInventory } from "./workflow-process-inventory";

function fixture() {
  const owner = "11111111-1111-4111-8111-111111111111";
  const pinnedAt = "2026-10-13T10:00:00.000Z", startedAt = "2026-10-13T10:00:01.000Z";
  const observedAt = "2026-10-13T10:00:02.000Z", stoppedAt = "2026-10-13T10:00:03.000Z";
  const node = { imagePath: "C:\\Program Files\\nodejs\\node.exe", sha256: "a".repeat(64), byteLength: 90_000_000,
    volumeSerialNumber: 123, fileIndex: "0000000000000001", pinnedAt };
  const esbuild = { imagePath: "D:\\owned\\node_modules\\esbuild.exe", sha256: "b".repeat(64), byteLength: 11_000_000,
    volumeSerialNumber: 456, fileIndex: "0000000000000002", pinnedAt };
  const image = (kind: "node" | "esbuild") => {
    const pin = kind === "node" ? node : esbuild;
    return { imagePath: pin.imagePath, sha256: pin.sha256, byteLength: pin.byteLength,
      volumeSerialNumber: pin.volumeSerialNumber, fileIndex: pin.fileIndex, kind, observedAt };
  };
  return { version: 1, context: { version: 1, batchId: "22222222-2222-4222-8222-222222222222", executionDomainId: owner,
    caseId: "public-tool-approval-idempotency", sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64),
    databaseBranchId: "br-owned", applicationName: `mvp_wf_${owner.replaceAll("-", "")}`, sdkDirectory: "D:/owned/sdk" },
    phase: "business", rootProcessId: 100, startedAt, stoppedAt, expectedImages: { node, esbuild },
    members: [{ processId: 100, imageObservationStatus: "observed", image: image("node"), exitCode: 0 },
      { processId: 101, imageObservationStatus: "observed", image: image("esbuild"), exitCode: 0 }],
    totalProcesses: 2, remainingOwnedProcesses: 0, inventoryComplete: true, stdoutEof: true, stderrEof: true,
    termination: "natural", observationStatus: "observed" };
}

describe("父方固定镜像的完整进程清单契约", () => {
  it("保留全 Node/native PID 与真实文件身份，不由 native 自报省略进程", () => {
    const raw = fixture(), parsed = WorkflowAcceptanceProcessInventory.parse(raw);
    expect(parsed.members.map((member) => member.processId)).toEqual([100, 101]);
    expect(parsed.members[1].image).toEqual(raw.members[1].image); expect(parsed.context).toEqual(raw.context);
    expect(parsed.expectedImages.node.fileIndex).toBe("0000000000000001");
  });
  it.each(["bridge", "migration"])("%s 阶段只有 Node 时仍须完整 Job/镜像事实", (phase) => {
    const raw = fixture(); raw.phase = phase; raw.members = [raw.members[0]]; raw.totalProcesses = 1;
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(true);
  });
  it("未知镜像仍保留 PID，事实为 null，不归类 native 或虚标零退出", () => {
    const raw = fixture(); raw.observationStatus = "unknown"; raw.inventoryComplete = false; raw.totalProcesses = null as unknown as number;
    raw.remainingOwnedProcesses = null as unknown as number; raw.stoppedAt = null as unknown as string; raw.termination = "unknown";
    raw.members[1] = { processId: 101, imageObservationStatus: "unknown", image: null as unknown as typeof raw.members[1]["image"], exitCode: null as unknown as number };
    const parsed = WorkflowAcceptanceProcessInventory.parse(raw);
    expect(parsed.members[1]).toEqual({ processId: 101, imageObservationStatus: "unknown", image: null, exitCode: null });
    expect(parsed.members).toHaveLength(2); expect(parsed.observationStatus).toBe("unknown");
  });
  it("Job 实际收齐但镜像未知时只保留 Job 事实，不虚标完整观察", () => {
    const raw = fixture(); raw.observationStatus = "unknown";
    raw.members[1].imageObservationStatus = "unknown"; raw.members[1].image = null as unknown as typeof raw.members[1]["image"];
    const parsed = WorkflowAcceptanceProcessInventory.parse(raw);
    expect(parsed.inventoryComplete).toBe(true); expect(parsed.observationStatus).toBe("unknown");
  });
  it.each(["unknown-with-image", "observed-with-null", "unsupported-kind", "unknown-category"])("拒绝矛盾镜像类别 %s", (kind) => {
    const raw = fixture();
    if (kind === "unknown-with-image") raw.members[1].imageObservationStatus = "unknown";
    if (kind === "observed-with-null") raw.members[1].image = null as unknown as typeof raw.members[1]["image"];
    if (kind === "unsupported-kind") raw.members[1].image.kind = "shell" as "esbuild";
    if (kind === "unknown-category") Object.assign(raw.members[1], { nativeExempt: true });
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false);
  });
  it.each(["imagePath", "sha256", "byteLength", "volumeSerialNumber", "fileIndex"] as const)("实际 %s 漂移不得匹配父固定镜像", (key) => {
    const raw = fixture(), image = raw.members[1].image;
    Object.assign(image, { [key]: key === "imagePath" ? "D:\\other\\esbuild.exe" : key === "sha256" ? "c".repeat(64)
      : key === "fileIndex" ? "0000000000000003" : key === "byteLength" ? image.byteLength + 1 : image.volumeSerialNumber + 1 });
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false);
  });
  it.each(["pin-after-start", "stop-before-start", "image-before-start", "image-after-stop", "bad-timestamp"])("拒绝生命周期矛盾 %s", (kind) => {
    const raw = fixture();
    if (kind === "pin-after-start") raw.expectedImages.node.pinnedAt = raw.stoppedAt;
    if (kind === "stop-before-start") raw.stoppedAt = raw.expectedImages.node.pinnedAt;
    if (kind === "image-before-start") raw.members[1].image.observedAt = raw.expectedImages.node.pinnedAt;
    if (kind === "image-after-stop") raw.members[1].image.observedAt = "2026-10-13T10:00:04.000Z";
    if (kind === "bad-timestamp") raw.startedAt = "2026-10-13T10:00:01+00:00";
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false);
  });
  it.each(["duplicate", "missing-root", "root-native", "empty", "too-many", "pid-zero", "pid-overflow", "pid-fraction"])("拒绝进程全集异常 %s", (kind) => {
    const raw = fixture();
    if (kind === "duplicate") raw.members[1].processId = raw.rootProcessId;
    if (kind === "missing-root") raw.rootProcessId = 999;
    if (kind === "root-native") raw.rootProcessId = 101;
    if (kind === "empty") raw.members = [];
    if (kind === "too-many") raw.members = Array.from({ length: 65 }, (_, index) => ({ ...raw.members[0], processId: 100 + index }));
    if (kind === "pid-zero") raw.members[1].processId = 0;
    if (kind === "pid-overflow") raw.members[1].processId = 0x100000000;
    if (kind === "pid-fraction") raw.members[1].processId = 1.5;
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false);
  });
  it.each(["total-count", "remaining", "exit-one", "unknown-exit", "stdout", "stderr", "forced", "unknown-termination", "missing-stop", "incomplete-job", "false-unknown"])("终态缺失 %s 不能报完整观察", (kind) => {
    const raw = fixture();
    if (kind === "total-count") raw.totalProcesses = 3;
    if (kind === "remaining") raw.remainingOwnedProcesses = 1;
    if (kind === "exit-one") raw.members[1].exitCode = 1;
    if (kind === "unknown-exit") raw.members[1].exitCode = null as unknown as number;
    if (kind === "stdout") raw.stdoutEof = false;
    if (kind === "stderr") raw.stderrEof = false;
    if (kind === "forced") raw.termination = "forced";
    if (kind === "unknown-termination") raw.termination = "unknown";
    if (kind === "missing-stop") raw.stoppedAt = null as unknown as string;
    if (kind === "incomplete-job") raw.inventoryComplete = false;
    if (kind === "false-unknown") raw.observationStatus = "unknown";
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false);
  });
  it.each(["relative.exe", "\\\\server\\node.exe", "\\\\?\\C:\\node.exe", "C:/node.exe", "C:\\..\\node.exe", "C:\\dir.\\node.exe", "C:\\dir \\node.exe", "C:\\node.exe:stream", "C:\\bad\"\\node.exe"])("拒绝未规范化镜像路径 %s", (imagePath) => {
    const raw = fixture(); raw.expectedImages.node.imagePath = imagePath;
    expect(WorkflowAcceptanceExecutablePin.safeParse(raw.expectedImages.node).success).toBe(false);
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false);
  });
  it.each(["same-file", "wrong-basename", "invalid-sha", "invalid-index", "oversized-image"])("拒绝固定身份异常 %s", (kind) => {
    const raw = fixture();
    if (kind === "same-file") { raw.expectedImages.esbuild.volumeSerialNumber = raw.expectedImages.node.volumeSerialNumber; raw.expectedImages.esbuild.fileIndex = raw.expectedImages.node.fileIndex; }
    if (kind === "wrong-basename") raw.expectedImages.node.imagePath = "C:\\other\\shell.exe";
    if (kind === "invalid-sha") raw.expectedImages.node.sha256 = "A".repeat(64);
    if (kind === "invalid-index") raw.expectedImages.node.fileIndex = "9007199254740993" + "0";
    if (kind === "oversized-image") raw.expectedImages.node.byteLength = 256 * 1024 * 1024 + 1;
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false);
  });
  it.each(["cleanupPermitted", "allRealmReceiptsCollected", "databaseSnapshotFresh", "databaseUrl", "apiKey", "nativeExempt"])("契约不授予许可或允许秘密字段 %s", (key) => {
    expect(WorkflowAcceptanceProcessInventory.safeParse({ ...fixture(), [key]: true }).success).toBe(false);
  });
  it("入口拒绝数据访问器、符号、循环和稀疏数组，不执行字段 getter", () => {
    const getter = vi.fn(), raw = fixture();
    Object.defineProperty(raw, "members", { get: getter, enumerable: true });
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(WorkflowAcceptanceProcessInventory.safeParse({ ...fixture(), [Symbol("unknown")]: true }).success).toBe(false);
    const circular = fixture(); Object.assign(circular, { self: circular }); expect(WorkflowAcceptanceProcessInventory.safeParse(circular).success).toBe(false);
    const sparse = fixture(); sparse.members = new Array(2); sparse.members[0] = fixture().members[0];
    expect(WorkflowAcceptanceProcessInventory.safeParse(sparse).success).toBe(false);
  });
  it("被动镜像不读取继承toJSON或缺失字段访问器", () => {
    const toJson = vi.fn(), inherited = vi.fn();
    const originalToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    const originalPhase = Object.getOwnPropertyDescriptor(Object.prototype, "phase");
    try {
      Object.defineProperty(Object.prototype, "toJSON", { get: toJson, configurable: true });
      Object.defineProperty(Object.prototype, "phase", { get: inherited, configurable: true });
      expect(WorkflowAcceptanceProcessInventory.safeParse(fixture()).success).toBe(true);
      const raw = fixture(); Reflect.deleteProperty(raw, "phase"); expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false);
      expect(toJson).not.toHaveBeenCalled(); expect(inherited).not.toHaveBeenCalled();
    } finally {
      if (originalToJson) Object.defineProperty(Object.prototype, "toJSON", originalToJson); else Reflect.deleteProperty(Object.prototype, "toJSON");
      if (originalPhase) Object.defineProperty(Object.prototype, "phase", originalPhase); else Reflect.deleteProperty(Object.prototype, "phase");
    }
  });
  it.each(["object", "array"])("伪造 %s 构造函数的 prototype getter 零调用拒绝", (kind) => {
    const getter = vi.fn(), constructor = () => undefined;
    Object.defineProperty(constructor, "prototype", { get: getter });
    const prototype = kind === "object" ? Object.create(null) : [];
    Object.defineProperty(prototype, "constructor", { value: constructor });
    const raw = fixture();
    Object.setPrototypeOf(kind === "object" ? raw : raw.members, prototype);
    expect(WorkflowAcceptanceProcessInventory.safeParse(raw).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it("字段合法且字符不足上限的全集，仍按真实UTF-8字节拒绝；合法小全集保留", () => {
    function unicodeFixture(length: number) {
      const raw = fixture(), imagePath = `C:\\${"界".repeat(length)}\\node.exe`;
      raw.expectedImages.node.imagePath = imagePath;
      raw.members = Array.from({ length: 64 }, (_, index) => ({ ...raw.members[0], processId: 100 + index,
        image: { ...raw.members[0].image, imagePath } }));
      raw.totalProcesses = 64;
      return raw;
    }
    const raw = unicodeFixture(1800);
    expect(JSON.stringify(raw).length).toBeLessThan(MAX_WORKFLOW_ACCEPTANCE_PROCESS_INVENTORY_BYTES);
    const result = WorkflowAcceptanceProcessInventory.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message === "进程清单只能包含有界被动数据")).toBe(true);
    expect(WorkflowAcceptanceProcessInventory.safeParse(unicodeFixture(600)).success).toBe(true);
  });
});
