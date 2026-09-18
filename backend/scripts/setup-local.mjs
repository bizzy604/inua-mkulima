import { randomBytes } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

const root = new URL('../../',import.meta.url);
const template = readFileSync(new URL('.env.example',root),'utf8');
const env = template
  .replace('replace-with-a-random-secret-at-least-32-characters',randomBytes(48).toString('base64url'))
  .replace('replace-with-bcrypt-hash',bcrypt.hashSync('Demo-checkout-123!',12));
try {
  writeFileSync(new URL('.env',root),env,{flag:'wx',mode:0o600});
  console.log('Created local .env. Demo username: demo; password: Demo-checkout-123!; simulated verification: 123456.');
} catch(error) {
  if(error.code === 'EEXIST') console.log('.env already exists; preserved without changes.');
  else throw error;
}
