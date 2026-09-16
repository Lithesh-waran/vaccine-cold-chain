'use strict';

/**
 * Creates a .env file from .env.example and fills in a freshly generated JWT_SECRET.
 * Usage: npm run setup
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const examplePath = path.join(root, '.env.example');
const envPath = path.join(root, '.env');

if (fs.existsSync(envPath)) {
  console.log('.env already exists - leaving it untouched.');
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  console.error('.env.example not found.');
  process.exit(1);
}

const secret = crypto.randomBytes(48).toString('hex');
const contents = fs
  .readFileSync(examplePath, 'utf8')
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`);

fs.writeFileSync(envPath, contents, { mode: 0o600 });
console.log('Created .env with a newly generated JWT_SECRET.');
console.log('Review MONGODB_URI, then run: npm run seed && npm start');
