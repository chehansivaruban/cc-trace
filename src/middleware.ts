import { NextResponse, type NextRequest } from "next/server";

// Transcripts can hold secrets. Refusing non-local Host headers blocks DNS-rebinding
// attacks, where a website you visit points its own domain at 127.0.0.1 to read them.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return new NextResponse("cc-trace only serves localhost", { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
