#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const target = process.argv[2];

if (!target) {
  console.error('Usage: node scripts/sync-pandasuite-json.js <auth|session>');
  process.exit(1);
}

const destination = path.join(__dirname, '..', 'public', 'pandasuite.json');

if (target === 'clear') {
  if (fs.existsSync(destination)) {
    fs.unlinkSync(destination);
    console.log(`Removed ${destination}`);
  }
  process.exit(0);
}

const source = path.join(
  __dirname,
  '..',
  'src',
  'json',
  target,
  'pandasuite.json',
);

if (!fs.existsSync(source)) {
  console.error(`Cannot find pandasuite.json for target "${target}" at ${source}`);
  process.exit(1);
}

fs.copyFileSync(source, destination);
console.log(`Pandasuite manifest synced from ${source} to ${destination}`);
