// ============================================================
// CellHub Pro — Main-process crash/error diagnostics (R-PRODUCTION-B3.1)
//
// Local-only, plain-text crash/error logger for the Electron MAIN process so a
// remote store can be supported without relying on volatile console output.
//
// HARD RULES:
//   • Local-only. NO cloud, NO upload, NO email, NO Sentry, NO UI.
//   • Logs ONLY controlled error fields (name/message/stack) and controlled
//     event metadata. NEVER stringifies arbitrary business objects — no cart,
//     no customer/PII, no payments, no tax/financial totals, no IPC payloads.
//   • scrubDiagnosticText() defensively redacts license keys / secrets / tokens
//     that could theoretically appear inside an error message or stack.
//   • The logger NEVER throws — a failed write must not crash the app.
//
// This module requires ONLY 'path' + 'fs' (NOT 'electron'); the Electron `app`
// is injected via initDiagnostics so the pure helpers are unit-testable.
// ============================================================

const path = require('path');
const fs = require('fs');

const REDACTED = '[REDACTED]';

// ── Redaction ────────────────────────────────────────────
// Defensive scrubbing of obviously-sensitive substrings. We never intentionally
// log secrets, but an error message/stack could embed one.
function scrubDiagnosticText(input) {
  if (input === undefined || input === null) return '';
  let s = String(input);

  // CHPRO-style license keys, e.g. CHPRO-PRO-20261231-AB12CD34
  s = s.replace(/CHPRO-[A-Za-z0-9-]+/g, REDACTED);

  // key/value pairs for sensitive keys (secret, token, password, apiKey,
  // license key, bearer, authorization, VITE_BRIDGE_AUTH_SECRET). Value may be
  // quoted or follow ':' or '='. Preserve the key + quote, redact the value.
  s = s.replace(
    /((?:vite_bridge_auth_secret|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|token|password|passwd|pwd|license[_-]?key|authorization|bearer)["']?\s*[:=]\s*)(["']?)([^\s"',;}]+)(\2)/gi,
    (_m, keyPart, q) => `${keyPart}${q}${REDACTED}${q}`,
  );

  // Long token-looking runs (>=24 chars of base64/hex/url-safe). Best-effort
  // catch for stray bearer/api tokens. Safe to over-redact in a diagnostics log.
  s = s.replace(/\b[A-Za-z0-9+/_-]{24,}={0,2}\b/g, REDACTED);

  return s;
}

// ── Formatting ───────────────────────────────────────────
// Deterministic given an explicit timestamp. `details` MUST be a controlled
// string (callers build it from whitelisted fields) — never an object.
function formatDiagnosticLine(level, event, details, timestamp) {
  const ts = timestamp || new Date().toISOString();
  const lvl = scrubDiagnosticText(level || 'info').toUpperCase();
  const ev = scrubDiagnosticText(event || 'event');
  let line = `[${ts}] [${lvl}] ${ev}`;
  if (details !== undefined && details !== null && details !== '') {
    line += ` | ${scrubDiagnosticText(details)}`;
  }
  return line;
}

// ── Paths ────────────────────────────────────────────────
function getDiagnosticsLogDir(appLike) {
  return path.join(appLike.getPath('userData'), 'logs');
}

function logFileName(timestamp) {
  const ts = timestamp || new Date().toISOString();
  return `cellhub-${ts.slice(0, 10)}.log`; // cellhub-YYYY-MM-DD.log
}

// ── Controlled detail builders (never stringify business objects) ──
function errToDetails(err) {
  if (!err) return 'error=<none>';
  const name = err.name || 'Error';
  const message = err.message || '';
  const stack = err.stack || '';
  return `name=${name} | message=${message} | stack=${stack}`;
}

function reasonToDetails(reason) {
  // Errors (and error-like objects) carry safe name/message/stack.
  if (reason instanceof Error || (reason && reason.stack)) return errToDetails(reason);
  // Plain strings are safe enough (scrubbed downstream).
  if (typeof reason === 'string') return `reason=${reason}`;
  // NEVER stringify an arbitrary object — it could carry business data/PII.
  return `reason=<non-error:${typeof reason}>`;
}

// ── Writer (impure) ──────────────────────────────────────
let _appRef = null;

function writeLine(line) {
  try {
    if (!_appRef) return;
    const dir = getDiagnosticsLogDir(_appRef);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, logFileName()), line + '\n', 'utf8');
  } catch (e) {
    // The logger must NEVER throw.
    try { console.error('[diagnostics] write failed:', e && e.message); } catch (_e) { /* noop */ }
  }
}

function logDiagnosticEvent(level, event, details) {
  const line = formatDiagnosticLine(level, event, details);
  try { console.error(line); } catch (_e) { /* noop */ } // dev visibility
  writeLine(line);
}

// ── Init / wiring ────────────────────────────────────────
function safeVersion(app) {
  try {
    return app && typeof app.getVersion === 'function' ? app.getVersion() : 'unknown';
  } catch (_e) {
    return 'unknown';
  }
}

let _initialized = false;

// initDiagnostics({ app, getMainWindow?, autoUpdater? })
// Idempotent: only the first call wires handlers (guards against double-binding
// process-level listeners across hot paths). `getMainWindow` is accepted for
// API compatibility; render crashes are captured app-wide via
// 'web-contents-created' so window recreation is covered regardless of timing.
function initDiagnostics(opts) {
  const { app, autoUpdater } = opts || {};
  _appRef = app || _appRef;

  if (_initialized) return;
  _initialized = true;

  // app-start
  logDiagnosticEvent(
    'info',
    'app-start',
    `version=${safeVersion(app)} platform=${process.platform} electron=${process.versions.electron} node=${process.versions.node}`,
  );

  // uncaughtException — log; do not swallow Node/Electron default handling.
  process.on('uncaughtException', (err) => {
    logDiagnosticEvent('fatal', 'uncaughtException', errToDetails(err));
  });

  // unhandledRejection — ADD a listener (the existing console one in main.js
  // stays; Node allows multiple listeners).
  process.on('unhandledRejection', (reason) => {
    logDiagnosticEvent('error', 'unhandledRejection', reasonToDetails(reason));
  });

  // renderer crashes — app-wide so recreated windows are covered too.
  if (app && typeof app.on === 'function') {
    app.on('web-contents-created', (_e, contents) => {
      try {
        contents.on('render-process-gone', (_ev, d) => {
          logDiagnosticEvent(
            'fatal',
            'render-process-gone',
            `reason=${d && d.reason} exitCode=${d && d.exitCode}`,
          );
        });
      } catch (_err) { /* noop */ }
    });

    // utility/GPU child-process crashes (low-risk, app-level event).
    app.on('child-process-gone', (_e, d) => {
      logDiagnosticEvent(
        'error',
        'child-process-gone',
        `type=${d && d.type} reason=${d && d.reason} exitCode=${d && d.exitCode}`,
      );
    });
  }

  // autoUpdater errors — log only, NO behavior change.
  if (autoUpdater && typeof autoUpdater.on === 'function') {
    try {
      autoUpdater.on('error', (err) => {
        logDiagnosticEvent('error', 'autoUpdater-error', errToDetails(err));
      });
    } catch (_err) { /* noop */ }
  }
}

module.exports = {
  initDiagnostics,
  logDiagnosticEvent,
  scrubDiagnosticText,
  formatDiagnosticLine,
  getDiagnosticsLogDir,
};
