import { NextResponse } from "next/server";
import {
  authMode,
  getToken,
  guardLogin,
  isSecureRequest,
  safeEqual,
  serializeSessionCookie,
} from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Exchange the shared PERSISTENCE_API_TOKEN for an HttpOnly, SameSite=Strict
 * session cookie (used by the Settings "unlock" control and by e2e setups).
 * The response never echoes the token; failures are generic.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const limited = guardLogin(request);
  if (limited) return limited;

  const mode = authMode();
  if (mode === "denied") {
    return NextResponse.json(
      { ok: false, error: "forbidden", message: "Persistence API disabled — set PERSISTENCE_API_TOKEN." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  if (mode === "open") {
    return NextResponse.json(
      { ok: true, auth: "open", message: "Authentication is not enabled in this environment." },
      { headers: { "cache-control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  const provided = (body as { token?: unknown })?.token;
  const secret = getToken();
  if (typeof provided !== "string" || !secret || !safeEqual(provided.trim(), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized", message: "Invalid token." }, {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }

  const response = NextResponse.json({ ok: true, auth: "token" }, { headers: { "cache-control": "no-store" } });
  response.headers.append("set-cookie", serializeSessionCookie(Date.now() + SESSION_TTL_MS, secret, isSecureRequest(request)));
  return response;
}
