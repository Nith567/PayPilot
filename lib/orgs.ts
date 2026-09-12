import { orgs } from './db';
import type { OrgDoc } from './types';

// v1: one org per user (the creator is the owner/admin).
export async function getOrgForUser(userId: string): Promise<OrgDoc | null> {
  return (await orgs()).findOne({ ownerPrivyUserId: userId });
}
