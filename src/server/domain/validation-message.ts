import type { z } from "zod";

export function validationMessage(error: z.ZodError, fallback: string): string {
  return error.issues.find((issue) => /[\u3400-\u9fff]/u.test(issue.message))?.message ?? fallback;
}
