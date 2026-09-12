import { MongoClient, type Collection, type Db, ObjectId } from 'mongodb';
import { requireEnv } from './env';
import type { ActivityDoc, GovernanceDoc, MemberDoc, OrgDoc, PayoutDoc, ScheduleDoc, VendorDoc, WalletDoc } from './types';

// Mongo has no row-level security — every query in this app is scoped by
// orgId, and orgId always comes from the authenticated session, never from
// the request body.

let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  if (!clientPromise) {
    const uri = requireEnv('MONGODB_URI');
    // Fast fail: a misconfigured Atlas allowlist (or dead cluster) should
    // surface in seconds, not after 30s of retrying.
    clientPromise = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    }).connect();
  }
  return clientPromise;
}

function dbNameFromUri(): string {
  const uri = requireEnv('MONGODB_URI');
  try {
    const path = new URL(uri).pathname.replace(/^\//, '');
    return path || 'treasury-pilot';
  } catch {
    return 'treasury-pilot';
  }
}

async function db(): Promise<Db> {
  const client = await getClient();
  return client.db(dbNameFromUri());
}

async function col<T extends { _id: string }>(name: string): Promise<Collection<T>> {
  return (await db()).collection<T>(name);
}

export function newId(): string {
  return new ObjectId().toString();
}

export const orgs = () => col<OrgDoc>('orgs');
export const members = () => col<MemberDoc>('members');
export const wallets = () => col<WalletDoc>('wallets');
export const vendors = () => col<VendorDoc>('vendors');
export const payouts = () => col<PayoutDoc>('payouts');
export const schedules = () => col<ScheduleDoc>('schedules');
export const activity = () => col<ActivityDoc>('activity');
export const governance = () => col<GovernanceDoc>('governance');

export async function logActivity(
  doc: Omit<ActivityDoc, '_id' | 'createdAt'>,
): Promise<void> {
  await (await activity()).insertOne({ _id: newId(), createdAt: Date.now(), ...doc });
}
