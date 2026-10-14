import { DraftNavigationGuard } from "@/features/workflow-canvas/DraftNavigationGuard";
import { AppShell } from "@/features/shell/AppShell";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DraftNavigationGuard />
      <AppShell>{children}</AppShell>
    </>
  );
}
