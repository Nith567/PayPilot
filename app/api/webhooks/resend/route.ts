import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { optionalEnv } from '@/lib/env';
import { orgs, vendors, logActivity } from '@/lib/db';
import { createOrgPayout } from '@/lib/payouts';
import { sendEmail } from '@/lib/email';

// Resend inbound-email webhook — the "vendor emails an invoice" flow.
//
// Register in the Resend dashboard: https://<your-domain>/api/webhooks/resend
// Events to listen to: email.received
//
// v1 parsing is regex-based (address + USDC amount); the LLM invoice parser
// is the next upgrade. The invoice lands as a normal payout request — tier
// routing, policy gates and quorum approval all apply unchanged, so a
// spoofed invoice can never pay an un-allowlisted address.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  const secret = optionalEnv('RESEND_WEBHOOK_SECRET');
  if (secret) {
    const id = req.headers.get('svix-id');
    const ts = req.headers.get('svix-timestamp');
    const sigHeader = req.headers.get('svix-signature');
    if (!id || !ts || !sigHeader) {
      return NextResponse.json({ error: 'missing signature headers' }, { status: 400 });
    }
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
  if (event?.type !== 'email.received') return NextResponse.json({ ok: true });

  const from: string = String(event?.data?.from ?? '').toLowerCase();
  const text: string = String(event?.data?.text ?? '') + ' ' + String(event?.data?.subject ?? '');
  const subject: string = String(event?.data?.subject ?? 'Invoice');

  // Find the org by the vendor's registered email.
  const vendor = await (await vendors()).findOne({ email: from });
  if (!vendor) return NextResponse.json({ ok: true, ignored: 'unknown sender' });

  const org = await (await orgs()).findOne({ _id: vendor.orgId });
  if (!org) return NextResponse.json({ ok: true, ignored: 'org not found' });

  const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);
  const amountMatch = text.match(/\$?\s?([0-9][0-9,]*(\.[0-9]{1,2})?)\s*(?:usdc|USDC)/);
  if (!addressMatch || !amountMatch) {
    await logActivity({
      orgId: org._id,
      type: 'payout_denied',
      message: `Invoice email from ${vendor.name} could not be parsed (${subject}) — no payout created`,
    });
    return NextResponse.json({ ok: true, ignored: 'unparseable' });
  }

  const recipient = addressMatch[0];
  const amountUsdc = Number(amountMatch[1].replace(/,/g, ''));

  const result = await createOrgPayout(org, {
    recipient,
    amountUsdc,
    memo: `Invoice email: ${subject.slice(0, 200)}`,
    creatorName: 'Invoice email',
  });

  if (result.denied) {
    await logActivity({
      orgId: org._id,
      type: 'payout_denied',
      message: `Invoice email from ${vendor.name} blocked by policy: ${result.reason}`,
    });
    void sendEmail(
      from,
      `PayPilot · invoice blocked: ${subject.slice(0, 80)}`,
      `<div style="font-family:sans-serif;color:#e6edf7;background:#0b1220;padding:24px"><p>Your invoice was received but <strong>blocked by policy</strong>: ${result.reason}</p><p style="color:#8b9bb4;font-size:12px">Policy is enforced at signature time — replies to this email do not change it.</p></div>`,
    );
  } else {
    void sendEmail(
      from,
      `PayPilot · invoice received: ${subject.slice(0, 80)}`,
      `<div style="font-family:sans-serif;color:#e6edf7;background:#0b1220;padding:24px"><p>Your invoice for <strong>$${amountUsdc} USDC</strong> was received and is now pending approval.</p></div>`,
    );
  }

  return NextResponse.json({ ok: true, payout: !!result.payout, denied: !!result.denied });
}
