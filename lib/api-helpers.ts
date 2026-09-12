import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from './auth';
import { ForbiddenError } from './authz';

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type RouteContext = { params: Promise<Record<string, string>> };

type Handler = (
  req: NextRequest,
  userId: string,
  ctx: RouteContext,
) => Promise<NextResponse>;

// Wraps authenticated API routes: verifies the Privy session token, maps
// auth failures to 401, and surfaces thrown errors as JSON.
export function withAuth(handler: Handler) {
  return async (req: NextRequest, ctx: RouteContext) => {
    try {
      const userId = await requireUser(req);
      return await handler(req, userId, ctx);
    } catch (err) {
      if (err instanceof AuthError) return apiError(err.message, 401);
      if (err instanceof ForbiddenError) return apiError(err.message, 403);
      console.error('[api]', err);
      return apiError(err instanceof Error ? err.message : 'Internal error', 500);
    }
  };
}
