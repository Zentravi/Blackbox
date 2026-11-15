import { NextResponse } from "next/server";
import { saveState } from "@/server/persistence";
import { isValidSimState } from "@/lib/snapshot";
import { guardPersistence } from "@/server/auth";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Snapshots stay well under this (typically < 2 MB; telemetry-heavy runs ~4 MB). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const denied = guardPersistence(request);
  if (denied) return denied;

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let body: { state?: unknown; mode?: unknown };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "payload too large" }, { status: 413 });
    }
    body = JSON.parse(text) as { state?: unknown; mode?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { state, mode } = body ?? {};
  if (!isValidSimState(state)) {
    return NextResponse.json({ error: "invalid simulation state" }, { status: 422 });
  }
  const saveMode = mode === "full" ? "full" : "snapshot";

  try {
    const result = await saveState(state, saveMode);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // Driver errors stay in the server log — never in the response body.
    console.error("[persistence/save] failed", err);
    return NextResponse.json({ error: "save failed" }, { status: 503 });
  }
}
