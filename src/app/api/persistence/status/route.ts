import { NextResponse } from "next/server";
import { getStatus } from "@/server/persistence";

export const runtime = "nodejs";

export async function GET() {
  const status = await getStatus();
  return NextResponse.json(status, {
    headers: { "cache-control": "no-store" },
  });
}
