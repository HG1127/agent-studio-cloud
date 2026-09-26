import { RunDetail } from "@/features/runs/RunDetail";
import { notFound } from "next/navigation";
import { z } from "zod";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) notFound();
  return <RunDetail runId={runId} />;
}
