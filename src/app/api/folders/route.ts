import path from "node:path";
import { PROJECTS_ROOT, userHome } from "@/lib/claude-logs";

export const dynamic = "force-dynamic";

/** Where cc-trace reads from, for the read-only display in Settings. */
export function GET() {
  const claude = path.dirname(PROJECTS_ROOT);
  return Response.json({ claude, projects: PROJECTS_ROOT, debug: path.join(claude, "debug"), home: userHome() });
}
