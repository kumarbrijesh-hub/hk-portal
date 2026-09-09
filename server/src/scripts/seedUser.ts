/**
 * Creates or updates a login.
 *   npm run seed -- <email> "<name>" <password> [operator|admin]
 */
import { migrate } from '../db/index.js';
import { userRepo } from '../repos/userRepo.js';

migrate();

const [email, name, password, role = 'operator'] = process.argv.slice(2);

if (!email || !name || !password) {
  console.error('Usage: npm run seed -- <email> "<name>" <password> [operator|admin]');
  process.exit(1);
}

if (role !== 'operator' && role !== 'admin') {
  console.error('Role must be "operator" or "admin".');
  process.exit(1);
}

const existing = userRepo.findByEmail(email);
if (existing) {
  userRepo.setPassword(email, password);
  console.log(`Password updated for ${email}.`);
} else {
  const user = userRepo.create({ email, name, password, role });
  console.log(`Created ${user.role} account: ${user.email} (${user.name})`);
}
