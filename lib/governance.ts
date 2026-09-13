import { privy } from './privy';
import { getOrgSignerPrivateKeyBase64 } from './app-signer';
import { governance, logActivity, newId } from './db';
import { ROLE_LABELS } from './types';
import type { GovernanceDoc, MemberRole, OrgDoc } from './types';

export interface QuorumMutationInput {
  orgId: string;
  quorumId: string;
  kind: GovernanceDoc['kind'];
  title: string;
  body: Record<string, unknown>;
  currentThreshold: number;
  ownerToken?: string;
}

// Add an activated member's Privy user to the org's key quorums (main + ops),
// making them a real signer on every wallet.
//  - Ops quorum runs at threshold 1 → the org signer key applies the change immediately.
//  - Main quorum: threshold ≤ 1 → immediate; ≥ 2 → governance intent the
//    signers approve in the UI.
export async function addMemberToQuorums(
  org: OrgDoc,
  member: { email: string; role: MemberRole; privyUserId: string },
): Promise<{ direct: boolean }> {
  // 1) Ops quorum (threshold 1) — immediate, signed by the org signer key
  const opsQuorum = await privy().keyQuorums().get(org.opsQuorumId);
  const opsUserIds = [...(opsQuorum.user_ids ?? [])];
  if (!opsUserIds.includes(member.privyUserId)) {
    opsUserIds.push(member.privyUserId);
    await privy().keyQuorums().update(org.opsQuorumId, {
      authorization_context: {
        authorization_private_keys: [getOrgSignerPrivateKeyBase64()],
      },
      user_ids: opsUserIds,
      public_keys: (opsQuorum.authorization_keys ?? []).map((k) => k.public_key),
      key_quorum_ids: opsQuorum.key_quorum_ids,
      authorization_threshold: opsQuorum.authorization_threshold ?? 1,
    });
  }

  // 2) Main quorum — direct when threshold ≤ 1, governance intent otherwise
  const mainQuorum = await privy().keyQuorums().get(org.privyQuorumId);
  const mainUserIds = [...(mainQuorum.user_ids ?? [])];
  if (mainUserIds.includes(member.privyUserId)) return { direct: true };
  mainUserIds.push(member.privyUserId);
  const result = await mutateQuorum({
    orgId: org._id,
    quorumId: org.privyQuorumId,
    kind: 'add_signer',
    title: `Add ${ROLE_LABELS[member.role]} ${member.email} as a signer`,
    body: {
      user_ids: mainUserIds,
      key_quorum_ids: mainQuorum.key_quorum_ids,
      authorization_threshold: mainQuorum.authorization_threshold ?? undefined,
    },
    currentThreshold: mainQuorum.authorization_threshold ?? 1,
  });
  return { direct: result.direct };
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
    // Threshold 1: the org signer key alone satisfies the quorum update.
    await privy().keyQuorums().update(input.quorumId, {
      authorization_context: {
        authorization_private_keys: [getOrgSignerPrivateKeyBase64()],
      },
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
