// ============================================================
// CellHub Pro — Offline License Key System
//
// Key format: CHPRO-TIER-YYYYMMDD-XXXXXXXX-CHECKSUM
//   TIER:      B = Basic, P = Pro, T = Trial
//   YYYYMMDD:  Expiry date (00000000 = perpetual)
//   XXXXXXXX:  8-char random hex
//   CHECKSUM:  first 8 chars of HMAC-SHA256(payload, secret)
//
// Trial: 14-day auto-generated key stored in config
// Basic: limited features (no reports, no multi-store, no SMS)
// Pro:   full features
// ============================================================

const crypto = require('crypto');

const LICENSE_SECRET = process.env.CELLHUB_LICENSE_SECRET || 'cellhub-pro-license-secret-changeme';
const TRIAL_DAYS = 14;

/**
 * Generate an HMAC checksum for a payload string.
 */
function hmac(payload) {
  return crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
}

/**
 * Generate a license key.
 * @param {'B'|'P'|'T'} tier - Basic, Pro, or Trial
 * @param {string|null} expiryDate - 'YYYYMMDD' or null for perpetual
 * @returns {string} License key
 */
function generateLicenseKey(tier = 'P', expiryDate = null) {
  const tierCode = tier.toUpperCase().charAt(0);
  const expiry = expiryDate || '00000000';
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  const payload = `CHPRO-${tierCode}-${expiry}-${random}`;
  const checksum = hmac(payload);
  return `${payload}-${checksum}`;
}

/**
 * Validate a license key offline.
 * @param {string} key
 * @returns {{ valid: boolean, tier: string, expiresAt: string|null, expired: boolean, error?: string }}
 */
function validateLicenseKey(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, tier: 'none', expiresAt: null, expired: false, error: 'No key provided' };
  }

  const trimmed = key.trim().toUpperCase();
  const parts = trimmed.split('-');

  // Expected: CHPRO-T-YYYYMMDD-XXXXXXXX-CHECKSUM  (5 parts)
  if (parts.length !== 5 || parts[0] !== 'CHPRO') {
    return { valid: false, tier: 'none', expiresAt: null, expired: false, error: 'Invalid key format' };
  }

  const [prefix, tierCode, expiry, random, checksum] = parts;

  // Verify HMAC checksum
  const payload = `${prefix}-${tierCode}-${expiry}-${random}`;
  const expected = hmac(payload);

  if (checksum !== expected) {
    return { valid: false, tier: 'none', expiresAt: null, expired: false, error: 'Invalid key (checksum failed)' };
  }

  // Parse tier
  const tierMap = { B: 'basic', P: 'pro', T: 'trial' };
  const tier = tierMap[tierCode] || 'unknown';

  // Parse expiry
  let expiresAt = null;
  let expired = false;

  if (expiry !== '00000000') {
    const y = parseInt(expiry.slice(0, 4));
    const m = parseInt(expiry.slice(4, 6)) - 1;
    const d = parseInt(expiry.slice(6, 8));
    const expiryDate = new Date(y, m, d, 23, 59, 59);
    expiresAt = expiryDate.toISOString();
    expired = expiryDate < new Date();
  }

  return {
    valid: !expired,
    tier,
    expiresAt,
    expired,
    error: expired ? 'License has expired' : undefined,
  };
}

/**
 * Generate a trial key that expires in TRIAL_DAYS.
 */
function generateTrialKey() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + TRIAL_DAYS);
  const y = expiry.getFullYear();
  const m = String(expiry.getMonth() + 1).padStart(2, '0');
  const d = String(expiry.getDate()).padStart(2, '0');
  return generateLicenseKey('T', `${y}${m}${d}`);
}

/**
 * Get remaining trial days.
 */
function getTrialDaysRemaining(expiresAt) {
  if (!expiresAt) return 0;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

/**
 * Feature gates per tier.
 */
const TIER_FEATURES = {
  trial: {
    maxProducts: 100,
    reports: true,
    sms: false,
    multiStore: false,
    autoUpdate: false,
    aiAssistant: false,
    label: 'Trial',
  },
  basic: {
    maxProducts: 500,
    reports: true,
    sms: false,
    multiStore: false,
    autoUpdate: true,
    aiAssistant: false,
    label: 'Basic',
  },
  pro: {
    maxProducts: Infinity,
    reports: true,
    sms: true,
    multiStore: true,
    autoUpdate: true,
    aiAssistant: true,
    label: 'Pro',
  },
  none: {
    maxProducts: 50,
    reports: false,
    sms: false,
    multiStore: false,
    autoUpdate: false,
    aiAssistant: false,
    label: 'Unlicensed',
  },
};

function getTierFeatures(tier) {
  return TIER_FEATURES[tier] || TIER_FEATURES.none;
}

module.exports = {
  generateLicenseKey,
  validateLicenseKey,
  generateTrialKey,
  getTrialDaysRemaining,
  getTierFeatures,
  TRIAL_DAYS,
};
