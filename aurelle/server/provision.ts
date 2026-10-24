import 'dotenv/config';
import { z } from 'zod';
import { hash } from 'argon2';
import { initDB, closeDB, transaction } from './db.ts';
import { id } from './domain.ts';
import { encryptFactor } from './security.ts';
// Controlled onboarding CLI, using a migration/operator connection. No public bootstrap endpoint.
// Credentials are supplied through stdin and are never printed or stored in a configuration file.
console.log(
  'Provide one JSON object on stdin: business_name, branch_name, address, owner_name, email, password, totp_secret.',
);
let input = '';
for await (const chunk of process.stdin) input += chunk;
const schema = z.object({
  business_name: z.string().min(2),
  branch_name: z.string().min(2),
  address: z.string().min(5),
  owner_name: z.string().min(2),
  email: z.email(),
  password: z.string().min(14).max(200),
  totp_secret: z.string().regex(/^[A-Z2-7]{16,64}$/),
});
const values = schema.parse(JSON.parse(input));
await initDB(false, true);
const tenant = id(),
  branch = id(),
  owner = id();
await transaction(async (tx) => {
  await tx.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [tenant, values.business_name]);
  await tx.query('INSERT INTO branches(tenant_id,id,name,data) VALUES($1,$2,$3,$4)', [
    tenant,
    branch,
    values.branch_name,
    {
      address: values.address,
      open: '10:00',
      close: '20:00',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      cancellation_hours: 12,
      tax_rate: 0,
      closed_days: [],
    },
  ]);
  await tx.query(
    'INSERT INTO accounts(id,tenant_id,branch_id,name,email,password_hash,role,adult,mfa_secret) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8)',
    [
      owner,
      tenant,
      branch,
      values.owner_name,
      values.email,
      await hash(values.password),
      'owner',
      encryptFactor(values.totp_secret),
    ],
  );
}, tenant);
console.log(JSON.stringify({ tenant_id: tenant, branch_id: branch, owner_id: owner }));
await closeDB();
