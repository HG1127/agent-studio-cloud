// postgres-js 的 23505 会包在 DrizzleQueryError.cause 里，两层都要查
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const causeCode = (error as { cause?: { code?: string } | null })?.cause?.code;
  return code === "23505" || causeCode === "23505";
}
