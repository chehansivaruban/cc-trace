// Stub: replaced by its Phase 1 task.
import { ComingSoon } from "@/components/coming-soon";
import type { AppPageProps } from "@/lib/route";

export function LivePage({ navigate }: AppPageProps) {
  return <ComingSoon title="Live now" onBack={() => navigate({ page: "session" })} />;
}
