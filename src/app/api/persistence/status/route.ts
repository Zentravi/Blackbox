import { NextResponse } from "next/server";
import { getStatus } from "@/server/persistence";
import { guardPersistence } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const denied = guardPersistence(request);
  if (denied) return denied;
  try {
    const status = await getStatus();
    return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
  } catch {
    // Never echo driver errors — they can expose connection topology.
    console.error("[persistence/status] lookup failed");
    return NextResponse.json(
      { configured: Boolean(process.env.DATABASE_URL), connected: false, error: "connection failed" },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
