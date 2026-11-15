import { NextResponse } from "next/server";
import { guardLogin, isSecureRequest, serializeClearCookie } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clears the persistence session cookie (idempotent, safe without auth). */
export async function POST(request: Request): Promise<NextResponse> {
  const limited = guardLogin(request);
  if (limited) return limited;

  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  response.headers.append("set-cookie", serializeClearCookie(isSecureRequest(request)));
  return response;
}
