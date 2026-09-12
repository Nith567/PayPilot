import { privy } from './privy';
import { governance, logActivity, newId } from './db';
import type { GovernanceDoc } from './types';

export interface QuorumMutationInput {
  orgId: string;
  quorumId: string;
  kind: GovernanceDoc['kind'];
  title: string;
  body: Record<string, unknown>;
  currentThreshold: number;
  ownerToken: string;
}

// Mutate a key quorum (add signer / change threshold):
//  - threshold ≤ 1 → the owner's signature alone satisfies it: apply now.
//  - threshold ≥ 2 → the owner alone can't authorize the change. Create an
//    approval intent (Privy async governance); quorum members sign it in the
//    governance UI and Privy applies the mutation at threshold.
export async function mutateQuorum(
  input: QuorumMutationInput,
): Promise<{ direct: boolean; intentId?: string }> {
  if (input.currentThreshold <= 1) {
    await privy().keyQuorums().update(input.quorumId, {
      authorization_context: { user_jwts: [input.ownerToken] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(input.body as any),
    });
    return { direct: true };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const intent = (await privy().intents().updateKeyQuorum(input.quorumId, input.body as any)) as any;
  const intentId: string = intent.intent_id ?? intent.id;
  if (!intentId) throw new Error('Privy did not return a governance intent id');

  await (await governance()).insertOne({
    _id: newId(),
    orgId: input.orgId,
    intentId,
    kind: input.kind,
    quorumId: input.quorumId,
    title: input.title,
    body: input.body,
    status: 'pending',
    createdAt: Date.now(),
  });
  await logActivity({ orgId: input.orgId, type: 'governance_requested', message: `${input.title} (awaiting quorum approval)` });

  // Notify quorum signers by email (best-effort).
  try {
    const { sendGovernanceApprovalEmails, signerEmailsForOrg } = await import('./email');
    const orgName = (await import('./db')).orgs;
    const org = await (await orgName()).findOne({ _id: input.orgId });
    const signers = await signerEmailsForOrg(input.orgId);
    void sendGovernanceApprovalEmails(signers, {
      orgName: org?.name ?? 'your organization',
      title: input.title,
    });
  } catch {
    /* notifications are best-effort */
  }
  return { direct: false, intentId };
}
