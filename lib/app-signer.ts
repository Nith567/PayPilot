import { createPrivateKey, createPublicKey } from 'node:crypto';
import { requireEnv } from './env';

// The org signer key: an app-held P-256 authorization key registered in
// every org's key quorums. Intent authorization uses this key because
// authorization keys are the documented signer type for intent approvals —
// user-member signatures (ephemeral user signing keys) are not valid for
// org-wallet intents. The HUMAN still decides: the app only signs after an
// authenticated org member with an approve role clicks, and after the
// wallet's policy gates pass.

// Base64 PKCS8 (no PEM headers) — the AuthorizationContext format.
export function getOrgSignerPrivateKeyBase64(): string {
  return requireEnv('ORG_SIGNER_PRIVATE_KEY');
}

// SPKI DER, base64 — the format Privy expects for quorum `public_keys`.
export function getOrgSignerPublicKeyBase64(): string {
  const key = createPrivateKey({
    key: Buffer.from(getOrgSignerPrivateKeyBase64(), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
}
