import { NextResponse } from "next/server";
import { clearState } from "@/server/persistence";
import { guardPersistence } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Destructive wipe. Guarded three ways:
 *  1. authentication (session cookie or bearer token),
 *  2. origin/CSRF checks,
 *  3. explicit confirmation header `x-confirm: clear` (412 otherwise) —
 *     prevents accidental wipes from stale clients or bare `fetch` calls.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const denied = guardPersistence(request, { confirm: { name: "x-confirm", value: "clear" } });
  if (denied) return denied;
  try {
    await clearState();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[persistence/clear] failed", err);
    return NextResponse.json({ ok: false, error: "clear failed" }, { status: 503 });
  }
}
