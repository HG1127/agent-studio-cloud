import { ToolOperationResolveInput } from "@/contracts/tool-operation";
import { canonicalJson } from "@/server/domain/canonical-json";

export async function toolOperationRequestHash(payload: ToolOperationResolveInput): Promise<string | null> {
  try {
    if (typeof window === "undefined" || globalThis.isSecureContext !== true || !globalThis.crypto?.subtle?.digest) return null;
    const parsed = ToolOperationResolveInput.parse(payload);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(parsed)));
    const bytes = new Uint8Array(digest);
    if (digest.byteLength !== 32 || bytes.byteLength !== 32) return null;
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
