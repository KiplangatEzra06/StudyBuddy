#!/usr/bin/env node

const bcrypt = require('bcryptjs');

const input = process.argv[2];

if (!input) {
  console.error('Usage: node scripts/hash-password.js "your password"');
  console.error('Tip: avoid putting the password in shell history when possible.');
  process.exit(1);
}

bcrypt.hash(input, 12)
  .then(hash => {
    console.log(hash);
  })
  .catch(error => {
    console.error('Could not hash password:', error.message);
    process.exit(1);
  });
