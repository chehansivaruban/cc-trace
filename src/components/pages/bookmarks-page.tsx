// Stub: replaced by its Phase 1 task.
import { ComingSoon } from "@/components/coming-soon";
import type { AppPageProps } from "@/lib/route";

export function BookmarksPage({ navigate }: AppPageProps) {
  return <ComingSoon title="Bookmarks" onBack={() => navigate({ page: "session" })} />;
}
