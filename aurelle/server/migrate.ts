import 'dotenv/config';
import { initDB, closeDB } from './db.ts';
await initDB(false, true);
console.log(
  'Aurelle schema, exclusion constraints, immutable facts, and forced tenant policies migrated.',
);
await closeDB();
