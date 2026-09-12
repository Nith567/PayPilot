// Wipes ALL app data (Mongo docs + Privy orgs) for a clean slate.
// Dev-only tool: pnpm reset
process.loadEnvFile('/Users/nithinreddy/Desktop/pay-pilot/.env.local');
import { MongoClient } from 'mongodb';
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const SECRET = process.env.PRIVY_APP_SECRET;
const auth = 'Basic ' + Buffer.from(`${APP_ID}:${SECRET}`).toString('base64');

const res = await fetch('https://api.privy.io/v1/organizations', {
  headers: { 'privy-app-id': APP_ID, Authorization: auth },
});
const { data } = await res.json();
for (const o of data) {
  const del = await fetch(`https://api.privy.io/v1/organizations/${o.id}`, {
    method: 'DELETE',
    headers: { 'privy-app-id': APP_ID, Authorization: auth },
  });
  console.log(`privy org ${o.display_name}: DELETE ${del.status}`);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db();
for (const col of ['orgs', 'wallets', 'members', 'vendors', 'payouts', 'activity', 'governance']) {
  const r = await db.collection(col).deleteMany({});
  console.log(`mongo ${col}: -${r.deletedCount}`);
}
await client.close();
process.exit(0);
