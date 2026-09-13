import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { optionalEnv } from '@/lib/env';
import { payouts } from '@/lib/db';
import { syncPayoutStatus } from '@/lib/payouts';

// Privy webhook endpoint (dashboard → Configuration → Webhooks → /api/webhooks/privy).
// Polling is the app's source of truth (webhooks are a fast-path when the
// dashboard subscription is active). Verifies the Svix-style signature when
// PRIVY_WEBHOOK_SECRET is configured.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Svix-style signature verification (Privy uses the same scheme).
  // The svix wrapper returns nothing on success (jsonParse:false) — we
  // parse the raw payload ourselves after the signature check passes.
  const secret = optionalEnv('PRIVY_WEBHOOK_SECRET');
  if (secret) {
    const wh = new Webhook(secret);
    try {
      wh.verify(raw, {
        'svix-id': req.headers.get('svix-id') ?? '',
        'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
        'svix-signature': req.headers.get('svix-signature') ?? '',
      });
    } catch {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const type: string | undefined = event?.type;
  if (type?.startsWith('intent.')) {
    const intentId = event?.data?.id ?? event?.data?.intent_id ?? event?.data?.resource_id;
    if (intentId) {
      const payout = await (await payouts()).findOne({ intentId });
      if (payout) await syncPayoutStatus(payout);
    }
  }

  return NextResponse.json({ ok: true });
}
