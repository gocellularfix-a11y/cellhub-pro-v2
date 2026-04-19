#!/usr/bin/env node
// ============================================================
// CellHub Pro — License Key Generator
// Usage: node scripts/generate-license.js [tier] [expiry]
//   tier:   basic | pro | trial (default: pro)
//   expiry: YYYYMMDD or "perpetual" (default: perpetual)
//
// Examples:
//   node scripts/generate-license.js pro              → perpetual Pro key
//   node scripts/generate-license.js basic 20261231   → Basic key expiring Dec 31, 2026
//   node scripts/generate-license.js trial            → 14-day trial key
// ============================================================

const { generateLicenseKey, generateTrialKey, validateLicenseKey } = require('../electron/license');

const args = process.argv.slice(2);
const tier = (args[0] || 'pro').toLowerCase();
const expiry = args[1] || null;

let key;

if (tier === 'trial' || tier === 't') {
  key = generateTrialKey();
} else {
  const tierCode = tier === 'basic' || tier === 'b' ? 'B' : 'P';
  const expiryDate = expiry === 'perpetual' || !expiry ? null : expiry;
  key = generateLicenseKey(tierCode, expiryDate);
}

// Validate the key we just generated
const result = validateLicenseKey(key);

console.log('');
console.log('╔══════════════════════════════════════════════════╗');
console.log('║           CellHub Pro — License Key              ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log(`║  Key:     ${key.padEnd(39)}║`);
console.log(`║  Tier:    ${result.tier.padEnd(39)}║`);
console.log(`║  Expires: ${(result.expiresAt ? result.expiresAt.slice(0, 10) : 'Never (perpetual)').padEnd(39)}║`);
console.log(`║  Valid:   ${String(result.valid).padEnd(39)}║`);
console.log('╚══════════════════════════════════════════════════╝');
console.log('');
