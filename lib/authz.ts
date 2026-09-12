import { members, orgs } from './db';
import { ROLE_LABELS, type MemberDoc, type MemberRole, type OrgDoc } from './types';
import { getOrgForUser } from './orgs';

// Role-based access control, app layer. The spec's "store roles in your DB,
// but enforce critical rules via Privy" split:
//
//   - These permissions shape the UI and reject unauthorized API calls.
//   - Money-critical powers are re-enforced by Privy: only key-quorum members
//     can sign intents, and only policy-approved transfers can execute.
//     A role escalation in the DB cannot move funds alone.

const PERMS: Record<MemberRole, string[]> = {
  owner: ['org:read', 'wallet:create', 'vendor:write', 'payout:create', 'payout:approve', 'member:manage'],
  treasurer: ['org:read', 'payout:create', 'payout:approve'],
  finance_officer: ['org:read', 'payout:create'],
  viewer: ['org:read'],
};

export type Perm = (typeof PERMS)[MemberRole][number];

export function can(role: MemberRole, perm: Perm): boolean {
  return PERMS[role].includes(perm);
}

export class ForbiddenError extends Error {}

export function assertCan(role: MemberRole, perm: Perm): void {
  if (!can(role, perm)) {
    throw new ForbiddenError(`Your role (${ROLE_LABELS[role]}) is not allowed to ${perm}`);
  }
}

export interface Membership {
  org: OrgDoc;
  member: MemberDoc | null; // null only for pre-RBAC orgs (owner lookup fallback)
  role: MemberRole;
}

// Resolve the caller's org + role. Active membership rows win; otherwise the
// org-owner fallback keeps pre-RBAC orgs working.
export async function resolveMembershipForUser(userId: string): Promise<Membership | null> {
  const member = await (await members()).findOne({ privyUserId: userId, status: 'active' });
  if (member) {
    const org = await (await orgs()).findOne({ _id: member.orgId });
    if (!org) return null;
    return { org, member, role: member.role };
  }
  const org = await getOrgForUser(userId);
  if (org) return { org, member: null, role: 'owner' };
  return null;
}
