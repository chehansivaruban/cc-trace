// Stub: replaced by its Phase 1 task.
import { ComingSoon } from "@/components/coming-soon";
import type { AppPageProps } from "@/lib/route";

export function DashboardPage({ navigate }: AppPageProps) {
  return <ComingSoon title="Dashboard" onBack={() => navigate({ page: "session" })} />;
}
