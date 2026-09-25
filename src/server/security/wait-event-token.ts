import { randomBytes, timingSafeEqual } from "node:crypto";

export function createWaitEventToken(): string {
  return randomBytes(32).toString("base64url");
}

export function matchesWaitEventToken(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
