import { Resend } from 'resend';
import { optionalEnv } from './env';

// Email is a NOTIFICATION channel, never an approval mechanism — the
// signature is always produced in-app with the signer's Privy key. Emails
// carry magic links that open the app at the right approval screen.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export function emailEnabled(): boolean {
  return !!optionalEnv('RESEND_API_KEY');
}

// Fetch a received email's full content — Resend webhooks carry metadata
// only (from/to/subject), the body must be pulled by email id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getReceivedEmail(emailId: string): Promise<any> {
  const key = optionalEnv('RESEND_API_KEY');
  if (!key) throw new Error('RESEND_API_KEY is not configured');
  const resend = new Resend(key);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await resend.emails.receiving.get(emailId);
  // The SDK wraps responses as { data: Email } — unwrap defensively.
  return result?.data ?? result;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const key = optionalEnv('RESEND_API_KEY');
  if (!key) return;
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: optionalEnv('RESEND_FROM') ?? 'PayPilot <onboarding@resend.dev>',
    to,
    subject,
    html,
  });
  if (error) console.error('[email] send failed:', error.message);
}

const SHELL = (body: string) => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf7;padding:32px 16px">
    <div style="max-width:480px;margin:0 auto;background:#101a2e;border:1px solid #1e2c49;border-radius:12px;padding:28px">
      <p style="margin:0 0 8px;font-size:20px;font-weight:600"><span style="color:#10b981">◆</span> PayPilot</p>
      ${body}
      <p style="margin:24px 0 0;font-size:12px;color:#8b9bb4">
        This email is a notification only — approvals are signed with your
        Privy key in the app. Money authority lives in policy, not in this
        inbox.
      </p>
    </div>
  </div>`;

// Every quorum signer gets an approval notification with a magic link.
export async function sendPayoutApprovalEmails(
  signerEmails: string[],
  opts: {
    orgName: string;
    payoutId: string;
    amountUsdc: number;
    vendorName: string;
    walletName: string;
  },
): Promise<void> {
  if (!emailEnabled() || signerEmails.length === 0) return;
  const link = `${APP_URL}/dashboard/payouts/${opts.payoutId}`;
  const html = SHELL(`
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
      <strong>$${opts.amountUsdc.toLocaleString()} USDC → ${opts.vendorName}</strong>
      (${opts.walletName}) in <strong>${opts.orgName}</strong> needs your
      approval.
    </p>
    <a href="${link}" style="display:inline-block;background:#10b981;color:#052017;font-weight:600;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px">Open & sign →</a>
    <p style="margin:16px 0 0;font-size:12px;color:#8b9bb4">Or open ${link}</p>`);
  for (const email of signerEmails) {
    try {
      await sendEmail(email, `PayPilot · approve $${opts.amountUsdc.toLocaleString()} → ${opts.vendorName}`, html);
    } catch (err) {
      console.error('[email] approval notification failed for', email, err);
    }
  }
}

export async function sendGovernanceApprovalEmails(
  signerEmails: string[],
  opts: { orgName: string; title: string },
): Promise<void> {
  if (!emailEnabled() || signerEmails.length === 0) return;
  const link = `${APP_URL}/dashboard/team`;
  const html = SHELL(`
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
      <strong>${opts.title}</strong> in <strong>${opts.orgName}</strong> needs
      quorum approval.
    </p>
    <a href="${link}" style="display:inline-block;background:#10b981;color:#052017;font-weight:600;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px">Open & sign →</a>
    <p style="margin:16px 0 0;font-size:12px;color:#8b9bb4">Or open ${link}</p>`);
  for (const email of signerEmails) {
    try {
      await sendEmail(email, `PayPilot · governance approval: ${opts.title}`, html);
    } catch (err) {
      console.error('[email] governance notification failed for', email, err);
    }
  }
}

// Quorum signers with a known email address.
export async function signerEmailsForOrg(orgId: string): Promise<string[]> {
  const { members } = await import('./db');
  const rows = await (await members())
    .find({ orgId, inQuorum: true, email: { $ne: '' } })
    .toArray();
  return rows.map((m) => m.email);
}
