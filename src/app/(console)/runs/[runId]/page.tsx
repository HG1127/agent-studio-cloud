import { RunDetail } from "@/features/runs/RunDetail";
import { runReturnHref } from "@/features/runs/run-return-url";
import { firstSearchParam } from "@/lib/search-params";
import { notFound } from "next/navigation";
import { z } from "zod";

export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) notFound();
  const backHref = runReturnHref(firstSearchParam((await searchParams).from));
  return <RunDetail runId={runId} backHref={backHref} />;
}
