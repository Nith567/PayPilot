import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { optionalEnv } from '@/lib/env';
import { payouts } from '@/lib/db';
import { syncPayoutStatus } from '@/lib/payouts';

// Privy webhook endpoint (dashboard → Configuration → Webhooks → /api/webhooks/privy).
// Polling is the app's source of truth (webhooks are a fast-path when the
// dashboard subscription is active). Verifies the Svix-style signature when
// PRIVY_WEBHOOK_SECRET is configured.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  const secret = optionalEnv('PRIVY_WEBHOOK_SECRET');
  if (secret) {
    const id = req.headers.get('svix-id');
    const ts = req.headers.get('svix-timestamp');
    const sigHeader = req.headers.get('svix-signature');
    if (!id || !ts || !sigHeader) {
      return NextResponse.json({ error: 'missing signature headers' }, { status: 400 });
    }
    // "v1,<base64>" — possibly space-separated list
    const sig = sigHeader.split(' ').map((s) => s.split(',')[1]).find(Boolean) ?? '';
    const expected = createHmac('sha256', secret).update(`${id}.${ts}.${raw}`).digest('base64');
    const ok =
      sig.length === expected.length &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
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
