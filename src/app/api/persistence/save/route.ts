import { NextResponse } from "next/server";
import { saveState } from "@/server/persistence";
import { isValidSimState } from "@/lib/snapshot";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { state, mode } = (body ?? {}) as { state?: unknown; mode?: unknown };
  if (!isValidSimState(state)) {
    return NextResponse.json({ error: "invalid simulation state" }, { status: 422 });
  }
  const saveMode = mode === "full" ? "full" : "snapshot";

  try {
    const result = await saveState(state, saveMode);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save failed" },
      { status: 503 },
    );
  }
}
