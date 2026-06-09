// ============================================================
// CellHub Pro — LAN Pairing (LOCAL-LAN-PAIRING-PHASE-1-V1)
//
// Phase 1: HANDSHAKE ONLY. No data sync, no operation forwarding, no
// persist changes. This module stands up a tiny local HTTP server on the
// Primary computer so a Secondary computer on the SAME LAN can pair using
// a 6-digit code and receive a local trusted token. Nothing leaves the LAN;
// no cloud, no Firebase, no account.
//
// Built entirely on Node built-ins (http/os/crypto/fs) — no new deps.
// Self-contained state file (lan-pairing.json in userData) so it never
// touches the app's config.json or the renderer's localStorage.
// ============================================================
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
// LOCAL-LAN-AUTO-DISCOVERY-V1: UDP broadcast beacon so a Secondary can find the
// Primary without typing an IP. Node built-in only — no new dep.
const dgram = require('dgram');

const PORT = 47615;                 // uncommon high port, fixed for V1
// LOCAL-LAN-AUTO-DISCOVERY-V1
const DISCOVERY_PORT = 47616;       // UDP beacon port (PORT + 1)
const DISCOVERY_TAG = 'cellhub-lan-v1';
const BEACON_INTERVAL_MS = 2000;    // Primary re-advertises every 2s
const CODE_TTL_MS = 5 * 60 * 1000;  // 6-digit code expires after 5 min
const MAX_FAILED = 5;               // wrong-code attempts before the code is burned
const MAX_BODY = 8 * 1024;
// LOCAL-LAN-PAIRING-PHASE-2-READONLY-SNAPSHOT-V1: a snapshot older than this
// (since the Primary renderer last pushed it) is served but flagged stale.
const SNAPSHOT_STALE_MS = 60 * 1000;
const SNAPSHOT_SCHEMA_VERSION = 1;

let server = null;
let primaryName = 'CellHub Primary';
let userDataPath = null;
// LOCAL-LAN-PHASE-3A: callback into main.js to forward a validated operation
// to the Primary renderer (for display). Set via init({ onOperation }).
let onOperation = null;
// LAN-PHASE-3B-CREATE-CUSTOMER-FORWARDING-V1: async callback that hands a
// business operation to the Primary renderer (where persist lives) and resolves
// with the ACK body { ok, customerId, duplicate, error }. Set via init().
let dispatchOperation = null;
// LAN-LICENSE-INHERITANCE-V1: callback returning the Primary's SANITIZED
// license status (no key, no hardware fingerprint). Set via init({ getLicense }).
let getLicense = null;
// Accepted operation types. LAN_PING_OPERATION = harmless heartbeat (display
// only). CREATE_CUSTOMER + LAN_CUSTOMER_NOTE_ADD = forwarded writes, dispatched
// to the Primary renderer; every other type is rejected at the server.
const ALLOWED_OPS = new Set(['LAN_PING_OPERATION', 'CREATE_CUSTOMER', 'LAN_CUSTOMER_NOTE_ADD', 'CREATE_APPOINTMENT']);
// Operations routed through the renderer dispatcher (not the display-only path).
const DISPATCHED_OPS = new Set(['CREATE_CUSTOMER', 'LAN_CUSTOMER_NOTE_ADD', 'CREATE_APPOINTMENT']);
let lastOperation = null;
// Active pairing window: { code, expiresAt, failed } or null when none.
let pairState = null;
// PHASE 2: last snapshot the Primary renderer pushed in. Main can't read the
// renderer's localStorage, so the renderer is the source and main is dumb
// storage that serves it over /snapshot. { snap, receivedAt } or null.
let lastSnapshot = null;
// LOCAL-LAN-AUTO-DISCOVERY-V1: UDP beacon socket + timer (Primary only).
let beaconSocket = null;
let beaconTimer = null;

function init(opts) {
  userDataPath = (opts && opts.userDataPath) || null;
  if (opts && typeof opts.onOperation === 'function') onOperation = opts.onOperation;
  if (opts && typeof opts.dispatchOperation === 'function') dispatchOperation = opts.dispatchOperation;
  if (opts && typeof opts.getLicense === 'function') getLicense = opts.getLicense;
}

// ── Trusted-device store (own JSON file, never config.json) ──
function trustedFile() {
  return path.join(userDataPath || '.', 'lan-pairing.json');
}
function loadTrusted() {
  try {
    const raw = fs.readFileSync(trustedFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.devices) ? parsed.devices : [];
  } catch {
    return [];
  }
}
function saveTrusted(devices) {
  try {
    fs.writeFileSync(trustedFile(), JSON.stringify({ devices }, null, 2));
  } catch (e) {
    console.error('[lan] failed to persist trusted devices:', e.message);
  }
}

// ── Network helpers ──────────────────────────────────────────
function isPrivateIp(ip) {
  if (!ip) return false;
  const a = String(ip).replace(/^::ffff:/, '');         // strip IPv6-mapped prefix
  if (a === '127.0.0.1' || a === '::1') return true;     // loopback (same machine)
  const p = a.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  if (p[0] === 10) return true;                          // 10.0.0.0/8
  if (p[0] === 192 && p[1] === 168) return true;         // 192.168.0.0/16
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
  return false;
}

function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal && isPrivateIp(ni.address)) {
        return ni.address;
      }
    }
  }
  return null;
}

function gen6() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// PHASE 2: a Bearer token is valid if its hash matches a trusted device.
function tokenIsTrusted(token) {
  if (!token) return false;
  const h = sha256(token);
  return loadTrusted().some((d) => d.tokenHash === h);
}

function bearerFrom(req) {
  const auth = (req.headers && req.headers['authorization']) || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

// ── Snapshot (PHASE 2, read-only) ────────────────────────────
function setSnapshot(snap) {
  if (snap && typeof snap === 'object') {
    lastSnapshot = { snap, receivedAt: Date.now() };
  }
  return { ok: true };
}
function snapshotMeta() {
  if (!lastSnapshot) return null;
  return {
    generatedAt: lastSnapshot.snap && lastSnapshot.snap.generatedAt,
    receivedAt: lastSnapshot.receivedAt,
    stale: Date.now() - lastSnapshot.receivedAt > SNAPSHOT_STALE_MS,
  };
}

function generateCode() {
  pairState = { code: gen6(), expiresAt: Date.now() + CODE_TTL_MS, failed: 0 };
  return pairState;
}

function codeIsLive() {
  return !!(pairState && pairState.code && Date.now() < pairState.expiresAt && pairState.failed < MAX_FAILED);
}

// ── Pairing logic (Primary side) ─────────────────────────────
function handlePair(body, remoteIp) {
  // Same-LAN gate: only private/loopback addresses may pair.
  if (!isPrivateIp(remoteIp)) {
    return { status: 403, body: { ok: false, error: 'not_local' } };
  }
  if (!codeIsLive()) {
    const reason = pairState && pairState.failed >= MAX_FAILED ? 'too_many_attempts' : 'expired';
    return { status: 400, body: { ok: false, error: reason } };
  }
  const code = body && body.code;
  if (!code || String(code) !== pairState.code) {
    pairState.failed += 1;
    return { status: 401, body: { ok: false, error: 'invalid_code' } };
  }
  // Success — issue token, record trusted device, CONSUME the code.
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const deviceId = (body && String(body.deviceId || '').slice(0, 80)) || ('dev-' + crypto.randomBytes(4).toString('hex'));
  const deviceName = (body && String(body.deviceName || 'Device').slice(0, 60)) || 'Device';
  const devices = loadTrusted().filter((d) => d.deviceId !== deviceId);
  devices.push({ deviceId, deviceName, tokenHash, pairedAt: new Date().toISOString() });
  saveTrusted(devices);
  pairState = null; // single-use
  const lanIp = getLanIp();
  return {
    status: 200,
    body: { ok: true, token, primaryName, primaryUrl: lanIp ? `http://${lanIp}:${PORT}` : null },
  };
}

// ── LAN auto-discovery (LOCAL-LAN-AUTO-DISCOVERY-V1) ─────────
// Primary broadcasts a tiny UDP beacon every BEACON_INTERVAL_MS. The packet
// carries ONLY discovery metadata (name, url, port, timestamp). It never
// contains the pairing code, tokens, license keys, or any store data —
// pairing still requires the 6-digit code + token handshake over HTTP.
function startBeacon() {
  if (beaconSocket) return;
  try {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (e) => {
      console.error('[lan] beacon socket error:', e.code || e.message);
      stopBeacon();
    });
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch { /* ignore */ }
      beaconSocket = sock;
      const send = () => {
        if (!server) return; // only advertise while the Primary HTTP server is up
        const lanIp = getLanIp();
        const payload = Buffer.from(JSON.stringify({
          tag: DISCOVERY_TAG,
          primaryName,
          lanUrl: lanIp ? `http://${lanIp}:${PORT}` : null,
          port: PORT,
          timestamp: Date.now(),
        }));
        try { sock.send(payload, 0, payload.length, DISCOVERY_PORT, '255.255.255.255'); } catch { /* ignore */ }
      };
      send();
      beaconTimer = setInterval(send, BEACON_INTERVAL_MS);
    });
  } catch (e) {
    console.error('[lan] failed to start beacon:', e.message);
  }
}

function stopBeacon() {
  if (beaconTimer) { clearInterval(beaconTimer); beaconTimer = null; }
  if (beaconSocket) { try { beaconSocket.close(); } catch { /* ignore */ } beaconSocket = null; }
}

// Secondary side: listen for Primary beacons for a short window, collect the
// unique candidates, and return them. Authenticates NOTHING — the returned
// URLs are only convenience pre-fills; the 6-digit code is still required.
function discoverPrimaries(opts) {
  const timeoutMs = Math.min(Math.max(Number((opts && opts.timeoutMs) || 3500), 1000), 8000);
  return new Promise((resolve) => {
    const found = new Map(); // lanUrl -> candidate
    let sock;
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (e) {
      resolve({ ok: false, error: 'discovery_unavailable', primaries: [] });
      return;
    }
    let settled = false;
    const finish = (errCode) => {
      if (settled) return;
      settled = true;
      try { sock.close(); } catch { /* ignore */ }
      const primaries = Array.from(found.values()).sort((a, b) => b.lastSeen - a.lastSeen);
      resolve({ ok: !errCode, error: errCode, primaries });
    };
    sock.on('error', () => finish('discovery_error'));
    sock.on('message', (msg, rinfo) => {
      let data = null;
      try { data = JSON.parse(msg.toString()); } catch { return; }
      if (!data || data.tag !== DISCOVERY_TAG) return;
      if (!isPrivateIp(rinfo.address)) return; // same-LAN only
      const lanUrl = data.lanUrl || (data.port ? `http://${rinfo.address}:${data.port}` : null);
      if (!lanUrl) return;
      found.set(lanUrl, {
        primaryName: String(data.primaryName || 'CellHub Primary').slice(0, 60),
        lanUrl,
        port: Number(data.port) || PORT,
        address: rinfo.address,
        lastSeen: Date.now(),
      });
    });
    try {
      sock.bind(DISCOVERY_PORT, () => { try { sock.setBroadcast(true); } catch { /* ignore */ } });
    } catch (e) {
      finish('bind_failed');
      return;
    }
    setTimeout(() => finish(null), timeoutMs);
  });
}

// ── Server lifecycle (Primary) ───────────────────────────────
function startPrimary(opts) {
  if (opts && opts.primaryName) primaryName = String(opts.primaryName).slice(0, 60);
  if (server) return Promise.resolve(getStatus());
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      const remoteIp = req.socket && req.socket.remoteAddress;

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, primaryName }));
        return;
      }
      // PHASE 2: read-only snapshot — requires a trusted Bearer token + same LAN.
      if (req.method === 'GET' && req.url === '/snapshot') {
        if (!isPrivateIp(remoteIp)) {
          res.writeHead(403); res.end(JSON.stringify({ ok: false, error: 'not_local' })); return;
        }
        if (!tokenIsTrusted(bearerFrom(req))) {
          res.writeHead(401); res.end(JSON.stringify({ ok: false, error: 'unauthorized' })); return;
        }
        if (!lastSnapshot) {
          res.writeHead(200);
          res.end(JSON.stringify({
            ok: true, schemaVersion: SNAPSHOT_SCHEMA_VERSION, primaryName,
            generatedAt: null, stale: true, data: null, counts: null,
          }));
          return;
        }
        const meta = snapshotMeta();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, stale: meta ? meta.stale : true, ...lastSnapshot.snap }));
        return;
      }
      // LAN-LICENSE-INHERITANCE-V1: sanitized license status for a paired
      // Secondary to inherit. Bearer + same-LAN required. Never exposes the
      // license key or hardware fingerprint (getLicense returns sanitized).
      if (req.method === 'GET' && req.url === '/license-status') {
        if (!isPrivateIp(remoteIp)) {
          res.writeHead(403); res.end(JSON.stringify({ ok: false, error: 'not_local' })); return;
        }
        if (!tokenIsTrusted(bearerFrom(req))) {
          res.writeHead(401); res.end(JSON.stringify({ ok: false, error: 'unauthorized' })); return;
        }
        const lic = getLicense ? getLicense() : null;
        res.writeHead(200);
        res.end(JSON.stringify({
          ok: true,
          primaryName,
          pairedCount: loadTrusted().length,
          ...(lic || { valid: false, tier: 'none', expiresAt: null }),
        }));
        return;
      }
      // PHASE 3A: operation forwarding skeleton — accepts ONLY the harmless
      // LAN_PING_OPERATION. No business data is read or written.
      if (req.method === 'POST' && req.url === '/operation') {
        if (!isPrivateIp(remoteIp)) {
          res.writeHead(403); res.end(JSON.stringify({ ok: false, error: 'not_local' })); return;
        }
        if (!tokenIsTrusted(bearerFrom(req))) {
          res.writeHead(401); res.end(JSON.stringify({ ok: false, error: 'unauthorized' })); return;
        }
        let data = '';
        let aborted = false;
        req.on('data', (c) => { data += c; if (data.length > MAX_BODY) { aborted = true; req.destroy(); } });
        req.on('end', () => {
          if (aborted) return;
          let op = {};
          try { op = JSON.parse(data || '{}'); } catch { op = {}; }
          if (!op || !ALLOWED_OPS.has(op.type)) {
            res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'unsupported_operation' })); return;
          }
          // LAN-PHASE-3B: dispatched operations (CREATE_CUSTOMER) go to the
          // Primary renderer, which persists and returns the real ACK. Main
          // never persists business data itself.
          if (DISPATCHED_OPS.has(op.type)) {
            if (typeof dispatchOperation !== 'function') {
              res.writeHead(200);
              res.end(JSON.stringify({ ok: false, operationId: String(op.operationId || ''), type: op.type, error: 'dispatch_unavailable' }));
              return;
            }
            Promise.resolve()
              .then(() => dispatchOperation(op))
              .then((ack) => {
                const body = ack && typeof ack === 'object' ? ack : { ok: false, error: 'empty_result' };
                res.writeHead(200);
                res.end(JSON.stringify({
                  ok: !!body.ok,
                  operationId: String(op.operationId || ''),
                  type: op.type,
                  customerId: body.customerId || undefined,
                  appointmentId: body.appointmentId || undefined,
                  duplicate: !!body.duplicate,
                  error: body.ok ? undefined : (body.error || 'dispatch_failed'),
                }));
              })
              .catch(() => {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: false, operationId: String(op.operationId || ''), type: op.type, error: 'dispatch_failed' }));
              });
            return;
          }
          // LAN_PING_OPERATION — display-only heartbeat (no business data).
          const receivedAt = Date.now();
          const record = {
            operationId: String(op.operationId || '').slice(0, 80),
            type: op.type,
            deviceId: String(op.deviceId || '').slice(0, 80),
            message: op.payload && typeof op.payload.message === 'string' ? op.payload.message.slice(0, 200) : '',
            receivedAt,
          };
          lastOperation = record;
          // Forward to the Primary renderer (display only — main never mutates state).
          if (onOperation) { try { onOperation(record); } catch (e) { /* non-fatal */ } }
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, receivedAt, operationId: record.operationId, type: record.type }));
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/pair') {
        let data = '';
        let aborted = false;
        req.on('data', (c) => {
          data += c;
          if (data.length > MAX_BODY) { aborted = true; req.destroy(); }
        });
        req.on('end', () => {
          if (aborted) return;
          let parsed = {};
          try { parsed = JSON.parse(data || '{}'); } catch { parsed = {}; }
          const result = handlePair(parsed, remoteIp);
          res.writeHead(result.status);
          res.end(JSON.stringify(result.body));
        });
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: 'not_found' }));
    });

    srv.on('error', (err) => {
      console.error('[lan] server error:', err.code || err.message);
      server = null;
      resolve({ running: false, error: err.code || 'server_error' });
    });
    srv.listen(PORT, '0.0.0.0', () => {
      server = srv;
      generateCode();
      startBeacon(); // LOCAL-LAN-AUTO-DISCOVERY-V1: advertise on the LAN
      console.log('[lan] primary listening on', PORT);
      resolve(getStatus());
    });
  });
}

function stopPrimary() {
  stopBeacon(); // LOCAL-LAN-AUTO-DISCOVERY-V1: stop advertising
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    server = null;
  }
  pairState = null;
  return { running: false };
}

function getStatus() {
  const lanIp = getLanIp();
  return {
    running: !!server,
    port: PORT,
    lanIp,
    lanUrl: lanIp ? `http://${lanIp}:${PORT}` : null,
    primaryName,
    // Only surface the code while the server is up and a live window exists.
    code: server && codeIsLive() ? pairState.code : null,
    codeExpiresAt: server && codeIsLive() ? pairState.expiresAt : null,
    pairedCount: loadTrusted().length,
    // PHASE 2: snapshot-endpoint state (for the Primary panel display).
    snapshotServed: snapshotMeta(),
  };
}

// Refresh the pairing code (only meaningful while the server runs).
function regenerateCode() {
  if (!server) return getStatus();
  generateCode();
  return getStatus();
}

// ── Secondary side: outbound pair request ────────────────────
function pairWithPrimary(opts) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(opts.primaryUrl);
    } catch {
      resolve({ ok: false, error: 'bad_url' });
      return;
    }
    const payload = JSON.stringify({
      code: String((opts && opts.code) || ''),
      deviceId: (opts && opts.deviceId) || '',
      deviceName: (opts && opts.deviceName) || 'Device',
    });
    const req = http.request(
      {
        host: url.hostname,
        port: url.port || PORT,
        path: '/pair',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        timeout: 8000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let body = null;
          try { body = JSON.parse(data || '{}'); } catch { body = null; }
          resolve(body && typeof body === 'object' ? body : { ok: false, error: 'bad_response' });
        });
      },
    );
    req.on('error', (err) => {
      const code = err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' ? 'unreachable' : (err.code || 'network_error');
      resolve({ ok: false, error: code });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

// ── Secondary side: fetch the read-only snapshot (PHASE 2) ───
function fetchSnapshot(opts) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL((opts && opts.primaryUrl) || '');
    } catch {
      resolve({ ok: false, error: 'bad_url' });
      return;
    }
    const req = http.request(
      {
        host: url.hostname,
        port: url.port || PORT,
        path: '/snapshot',
        method: 'GET',
        headers: { authorization: `Bearer ${(opts && opts.token) || ''}` },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; if (data.length > 25 * 1024 * 1024) req.destroy(); });
        res.on('end', () => {
          let body = null;
          try { body = JSON.parse(data || '{}'); } catch { body = null; }
          if (res.statusCode === 401) { resolve({ ok: false, error: 'unauthorized' }); return; }
          resolve(body && typeof body === 'object' ? body : { ok: false, error: 'bad_response' });
        });
      },
    );
    req.on('error', (err) => {
      const code = err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' ? 'unreachable' : (err.code || 'network_error');
      resolve({ ok: false, error: code });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

// ── Secondary side: send a test operation (PHASE 3A) ─────────
function sendOperation(opts) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL((opts && opts.primaryUrl) || '');
    } catch {
      resolve({ ok: false, error: 'bad_url' });
      return;
    }
    const payload = JSON.stringify((opts && opts.operation) || {});
    const req = http.request(
      {
        host: url.hostname,
        port: url.port || PORT,
        path: '/operation',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          authorization: `Bearer ${(opts && opts.token) || ''}`,
        },
        timeout: 8000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let body = null;
          try { body = JSON.parse(data || '{}'); } catch { body = null; }
          if (res.statusCode === 401) { resolve({ ok: false, error: 'unauthorized' }); return; }
          if (res.statusCode === 400) { resolve(body && body.error ? body : { ok: false, error: 'unsupported_operation' }); return; }
          resolve(body && typeof body === 'object' ? body : { ok: false, error: 'bad_response' });
        });
      },
    );
    req.on('error', (err) => {
      const code = err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' ? 'unreachable' : (err.code || 'network_error');
      resolve({ ok: false, error: code });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

// ── Secondary side: fetch Primary license status (LAN-LICENSE-INHERITANCE-V1) ──
function fetchLicense(opts) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL((opts && opts.primaryUrl) || '');
    } catch {
      resolve({ ok: false, error: 'bad_url' });
      return;
    }
    const req = http.request(
      {
        host: url.hostname,
        port: url.port || PORT,
        path: '/license-status',
        method: 'GET',
        headers: { authorization: `Bearer ${(opts && opts.token) || ''}` },
        timeout: 8000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let body = null;
          try { body = JSON.parse(data || '{}'); } catch { body = null; }
          if (res.statusCode === 401) { resolve({ ok: false, error: 'unauthorized' }); return; }
          resolve(body && typeof body === 'object' ? body : { ok: false, error: 'bad_response' });
        });
      },
    );
    req.on('error', (err) => {
      const code = err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' ? 'unreachable' : (err.code || 'network_error');
      resolve({ ok: false, error: code });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

module.exports = {
  init,
  startPrimary,
  stopPrimary,
  getStatus,
  regenerateCode,
  pairWithPrimary,
  setSnapshot,
  fetchSnapshot,
  sendOperation,
  fetchLicense,
  // LOCAL-LAN-AUTO-DISCOVERY-V1
  discoverPrimaries,
};
