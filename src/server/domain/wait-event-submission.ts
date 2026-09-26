export function runStatusConfirmsWaitEventSubmission(status: string): boolean {
  return status === "running" || status === "completed";
}
