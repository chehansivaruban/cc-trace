import { readLiveSessions } from "@/lib/claude-logs";

export const dynamic = "force-dynamic";

/** The Claude Code sessions running right now, from Claude Code's own registry. Takes no input. */
export async function GET() {
  return Response.json(await readLiveSessions());
}
