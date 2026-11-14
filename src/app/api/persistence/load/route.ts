import { NextResponse } from "next/server";
import { loadState } from "@/server/persistence";

export const runtime = "nodejs";

export async function GET() {
  try {
    const state = await loadState();
    return NextResponse.json(
      { state },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { state: null, error: err instanceof Error ? err.message : "load failed" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
