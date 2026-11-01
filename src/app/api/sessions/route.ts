import { listProjects } from "@/lib/claude-logs";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listProjects());
}
