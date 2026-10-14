import { RunDetail } from "@/features/runs/RunDetail";
import { collaborationNavigation } from "@/features/runs/run-collaboration-navigation";
import { notFound } from "next/navigation";
import { z } from "zod";

export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) notFound();
  const collaboration = collaborationNavigation(await searchParams);
  return <RunDetail runId={runId} backHref={collaboration.backHref} collaboration={collaboration} />;
}
