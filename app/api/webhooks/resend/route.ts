import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { optionalEnv } from '@/lib/env';
import { orgs, vendors, logActivity } from '@/lib/db';
import { createOrgPayout } from '@/lib/payouts';
import { getReceivedEmail, sendEmail } from '@/lib/email';

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

  // Svix-style signature verification (the official Resend scheme).
  // The svix wrapper returns nothing on success (jsonParse:false) — we
  // parse the raw payload ourselves after the signature check passes.
  const secret = optionalEnv('RESEND_WEBHOOK_SECRET');
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
  return handleEvent(event);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleEvent(event: any): Promise<NextResponse> {
  if (event?.type !== 'email.received') return NextResponse.json({ ok: true });

  const from: string = String(event?.data?.from ?? '').toLowerCase();
  // Resend webhooks carry metadata only — fetch the full email for the body.
  let text = '';
  let subject = String(event?.data?.subject ?? 'Invoice');
  const emailId = String(event?.data?.email_id ?? '');
  if (emailId) {
    try {
      const email = await getReceivedEmail(emailId);
      text = String(email?.text ?? email?.html ?? '');
      subject = String(email?.subject ?? subject);
    } catch (err) {
      console.error('[resend] failed to fetch email body:', err);
    }
  }
  text = text + ' ' + subject;

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
