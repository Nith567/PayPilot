import type { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { requireEnv } from './env';

// Every API route authenticates the caller's Privy session. The React SDK
// sends its access token as `Authorization: Bearer <token>` (getAccessToken());
// we verify it against Privy's app-specific JWKS — ES256, issuer `privy.io`,
// audience = our app id.
export async function requireUser(req: NextRequest): Promise<string> {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw new AuthError('Missing session token');

  const appId = requireEnv('NEXT_PUBLIC_PRIVY_APP_ID');
  const jwks = createRemoteJWKSet(
    new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`),
  );

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: 'privy.io',
      audience: appId,
    });
    return payload.sub as string;
  } catch {
    throw new AuthError('Invalid session');
  }
}

export class AuthError extends Error {}

// Raw bearer token — used where a route needs the caller's JWT itself
// (e.g. quorum updates authorized with the owner's signature).
export function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}
