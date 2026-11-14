import { NextResponse } from "next/server";
import { clearState } from "@/server/persistence";
import { isDatabaseConfigured } from "@/server/db";

export const runtime = "nodejs";

export async function DELETE() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 409 });
  }
  try {
    await clearState();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "clear failed" },
      { status: 503 },
    );
  }
}
