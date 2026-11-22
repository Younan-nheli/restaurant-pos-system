import 'dotenv/config';
import { pool } from './db/pool.js';
import { hashPassword, validatePassword } from './security/passwords.js';

const [emailArg, password] = process.argv.slice(2);
const email = (emailArg || '').trim().toLowerCase();
if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Usage: npm run seed:master -- admin@example.com "long-password"');
validatePassword(password);
try {
  const hash = await hashPassword(password);
  const result = await pool.query(
    `INSERT INTO app_users (restaurant_id,email,password_hash,role) VALUES (NULL,$1,$2,'master_admin') RETURNING id,email,role`, [email, hash]
  );
  console.log('Created master admin:', result.rows[0]);
} finally { await pool.end(); }
