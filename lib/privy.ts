import { PrivyClient, NotFoundError } from '@privy-io/node';
import { requireEnv } from './env';

export { NotFoundError };

// Server-side Privy client. Holds the app secret — server code only.
let privyClient: PrivyClient | null = null;

export function privy(): PrivyClient {
  if (!privyClient) {
    privyClient = new PrivyClient({
      appId: requireEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
      appSecret: requireEnv('PRIVY_APP_SECRET'),
    });
  }
  return privyClient;
}

// HTTP Basic auth header value for raw REST calls (e.g. intent authorize).
export function privyBasicAuth(): string {
  const appId = requireEnv('NEXT_PUBLIC_PRIVY_APP_ID');
  const appSecret = requireEnv('PRIVY_APP_SECRET');
  return `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`;
}

export const PRIVY_API_BASE = 'https://api.privy.io';

// Minimal fetch wrapper for Privy REST endpoints the Node SDK doesn't expose
// (e.g. condition sets, intent authorize).
export async function privyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const appId = requireEnv('NEXT_PUBLIC_PRIVY_APP_ID');
  return fetch(`${PRIVY_API_BASE}${path}`, {
    ...init,
    headers: {
      'privy-app-id': appId,
      Authorization: privyBasicAuth(),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}
