// MongoDB document types. All app-side state — Privy is the source of truth
// for authority (wallets, quorums, policies, intents); Mongo mirrors it for UI.

// Roles live in the DB for UX/permissions — money-critical powers are
// enforced by Privy (quorum membership to sign, policies to transfer).
export type MemberRole = 'owner' | 'treasurer' | 'finance_officer' | 'viewer';

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  treasurer: 'Treasurer',
  finance_officer: 'Finance Officer',
  viewer: 'Viewer',
};

export interface MemberDoc {
  _id: string;
  orgId: string;
  privyUserId: string | null; // set at invite time when the wallet is pregenerated
  email: string; // '' for the owner row (resolved by privyUserId)
  role: MemberRole;
  status: 'invited' | 'active';
  inQuorum: boolean; // true when the member is a signer on the org key quorum
  pregenerated?: boolean; // wallet pregenerated at invite — waiting for first login
  createdAt: number;
}

export type WalletPurpose = 'treasury' | 'payroll' | 'bug_bounty' | 'ops' | 'custom';

export interface OrgDoc {
  _id: string; // = Privy organization id
  name: string;
  privyQuorumId: string; // main quorum (governs Treasury etc.)
  opsQuorumId: string; // ops quorum (governs the small-payout Ops wallet)
  opsWalletId: string; // wallet used for payouts ≤ tierAmountUsd
  ownerPrivyUserId: string;
  conditionSetId: string; // vendor allowlist (Privy condition set) shared by all wallets
  quorumThreshold?: number; // main-quorum approval threshold (default 1 until members join)
  tierAmountUsd?: number; // payouts ≤ this route to the Ops wallet (1-of-N); above → 2-of-N
  createdAt: number;
}

export interface WalletDoc {
  _id: string; // = Privy wallet id
  orgId: string;
  address: string;
  name: string;
  purpose: WalletPurpose;
  policyId: string | null;
  capUsd: number; // per-transaction cap, mirrored from the Privy policy
  createdAt: number;
}

export interface VendorDoc {
  _id: string;
  orgId: string;
  name: string;
  address: string; // checksummed
  email?: string;
  createdAt: number;
}

export type PayoutStatus =
  | 'pending'
  | 'executed'
  | 'denied'
  | 'expired'
  | 'failed';

export interface PayoutDoc {
  _id: string;
  orgId: string;
  walletId: string; // Privy wallet id
  walletName: string;
  recipient: string;
  vendorName: string | null;
  amountUsdc: number;
  amountWei: string; // hex
  memo: string;
  intentId: string | null;
  status: PayoutStatus;
  txHash: string | null;
  signedBy: string[];
  deniedReason: string | null;
  creatorName: string; // who requested it (role-based audit trail)
  createdAt: number;
}

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'once';

export interface ScheduleDoc {
  _id: string;
  orgId: string;
  recipient: string;
  vendorName: string | null;
  amountUsdc: number;
  frequency: ScheduleFrequency;
  nextRunAt: number;
  lastRunAt: number | null;
  memo: string;
  creatorName: string;
  status: 'active' | 'paused' | 'completed';
  createdAt: number;
}

// A governance change that needs quorum approval (e.g. adding a signer or
// changing the threshold once the quorum already requires 2 signatures).
export interface GovernanceDoc {
  _id: string;
  orgId: string;
  intentId: string;
  kind: 'add_signer' | 'set_threshold';
  quorumId: string;
  title: string;
  body: Record<string, unknown>; // the underlying PATCH payload (for signing)
  status: 'pending' | 'executed' | 'denied' | 'expired';
  createdAt: number;
}

export interface ActivityDoc {
  _id: string;
  orgId: string;
  type:
    | 'org_created'
    | 'wallet_created'
    | 'vendor_added'
    | 'member_invited'
    | 'member_joined'
    | 'member_signer'
    | 'governance_requested'
    | 'settings_updated'
    | 'payout_requested'
    | 'payout_approved'
    | 'payout_executed'
    | 'payout_denied'
    | 'wallet_funded';
  message: string;
  txHash?: string;
  payoutId?: string;
  createdAt: number;
}
