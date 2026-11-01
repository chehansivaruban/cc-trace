// Stub: replaced by its Phase 1 task.
import { ComingSoon } from "@/components/coming-soon";
import type { AppPageProps } from "@/lib/route";

export function SearchPage({ navigate }: AppPageProps) {
  return <ComingSoon title="Search" onBack={() => navigate({ page: "session" })} />;
}
