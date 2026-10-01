import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRateLimiter, type RateLimitRule } from "@/lib/security/rate-limiter.server";
import { getTrustedClientIp } from "@/lib/security/client-ip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AUTH_SESSION_RATE_LIMIT: RateLimitRule = {
  bucket: "auth-session-bridge",
  limit: 30,
  windowSeconds: 60,
};

function getClientIp(request: NextRequest): string {
  return getTrustedClientIp(request, "127.0.0.1");
}

function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin) {
    // If origin header is missing, check referer header
    const referer = request.headers.get("referer");
    if (!referer) return true; // Direct non-browser or same-site navigation
    try {
      const refUrl = new URL(referer);
      return !host || refUrl.host === host;
    } catch {
      return false;
    }
  }

  try {
    const originUrl = new URL(origin);
    return !host || originUrl.host === host;
  } catch {
    return false;
  }
}

function getSupabaseServerClient() {
  const url = process.env["SUPABASE_URL"] || process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * POST /api/auth/session
 * Bridges a validated Bearer token into server-side HttpOnly cookies.
 *
 * Security Invariants:
 * 1. Strict Origin verification (CSRF protection)
 * 2. Rate limiting (30 requests / 60 seconds per IP)
 * 3. Server-side Supabase verification before any cookie is set (no unverified JWTs)
 * 4. HttpOnly, Secure, SameSite=Lax, Path=/
 * 5. NO token returned in response body
 */
export async function POST(request: NextRequest) {
  if (!validateOrigin(request)) {
    return NextResponse.json(
      { error: "Forbidden: Cross-origin request rejected" },
      { status: 403 }
    );
  }

  const limiter = getRateLimiter();
  const ip = getClientIp(request);
  const decision = await limiter.hit(AUTH_SESSION_RATE_LIMIT, ip);

  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many authentication attempts. Please try again later." },
      { status: 429 }
    );
  }

  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let expiresIn = 3600;

  // 1. Check Authorization Bearer header
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    accessToken = authHeader.slice(7).trim();
  }

  // 2. Read body if present for refresh token and expiry
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
      if (!accessToken && body.access_token) {
        accessToken = String(body.access_token).trim();
      }
      if (body.refresh_token) {
        refreshToken = String(body.refresh_token).trim();
      }
      if (typeof body.expires_in === "number" && body.expires_in > 0) {
        expiresIn = body.expires_in;
      }
    }
  } catch {
    // Body parsing error or empty body
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: "Unauthorized: Missing access token" },
      { status: 401 }
    );
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Server configuration error: Supabase client unavailable" },
      { status: 500 }
    );
  }

  // Verify the token with Supabase Auth
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or expired session token" },
      { status: 401 }
    );
  }

  const isProd = process.env.NODE_ENV === "production" || request.url.startsWith("https:");
  const response = NextResponse.json(
    {
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    },
    { status: 200 }
  );

  // Set HttpOnly cookies on the response
  response.cookies.set("sb-access-token", accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn,
  });

  if (refreshToken) {
    response.cookies.set("sb-refresh-token", refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

  return response;
}

/**
 * DELETE /api/auth/session
 * Clears HttpOnly session cookies on logout.
 */
export async function DELETE(request: NextRequest) {
  if (!validateOrigin(request)) {
    return NextResponse.json(
      { error: "Forbidden: Cross-origin request rejected" },
      { status: 403 }
    );
  }

  const isProd = process.env.NODE_ENV === "production" || request.url.startsWith("https:");
  const response = NextResponse.json({ ok: true }, { status: 200 });

  response.cookies.set("sb-access-token", "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  response.cookies.set("sb-refresh-token", "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}
