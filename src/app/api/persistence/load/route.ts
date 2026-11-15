import { NextResponse } from "next/server";
import { loadState } from "@/server/persistence";
import { guardPersistence } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const denied = guardPersistence(request);
  if (denied) return denied;
  try {
    // loadState() re-validates the stored payload before returning it.
    const state = await loadState();
    return NextResponse.json({ state }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[persistence/load] failed", err);
    return NextResponse.json({ state: null, error: "load failed" }, { status: 503 });
  }
}
