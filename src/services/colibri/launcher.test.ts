// ============================================================
// P1-COLIBRI-LAUNCHER — launcher resolution tests
// The launcher must never pretend: disabled/not-configured/invalid states
// are explicit, URLs must be http(s), local paths must be absolute .exe
// and require the desktop channel.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  readColibriConfig, resolveColibriLaunch, isApprovedUrl,
  isExecutablePath, isValidColibriTarget,
} from './launcher';

describe('readColibriConfig', () => {
  it('reads the double-cast settings fields defensively', () => {
    expect(readColibriConfig({ colibriEnabled: true, colibriTarget: ' https://colibri.app ', colibriLastLaunchAt: '2026-07-23T00:00:00.000Z' }))
      .toEqual({ enabled: true, target: 'https://colibri.app', lastLaunchAt: '2026-07-23T00:00:00.000Z' });
    expect(readColibriConfig({})).toEqual({ enabled: false, target: '', lastLaunchAt: undefined });
    expect(readColibriConfig(null)).toEqual({ enabled: false, target: '', lastLaunchAt: undefined });
    expect(readColibriConfig({ colibriEnabled: 'yes', colibriTarget: 42 })).toEqual({ enabled: false, target: '', lastLaunchAt: undefined });
  });
});

describe('target validation', () => {
  it('accepts only http(s) URLs', () => {
    expect(isApprovedUrl('https://colibri.example.com')).toBe(true);
    expect(isApprovedUrl('http://localhost:5199')).toBe(true);
    expect(isApprovedUrl('file:///C:/x.exe')).toBe(false);
    expect(isApprovedUrl('javascript:alert(1)')).toBe(false);
    expect(isApprovedUrl('colibri.example.com')).toBe(false);
  });

  it('accepts only absolute Windows .exe paths (drive or UNC)', () => {
    expect(isExecutablePath('C:\\Program Files\\Colibri\\Colibri.exe')).toBe(true);
    expect(isExecutablePath('D:/Apps/Colibri.exe')).toBe(true);
    expect(isExecutablePath('\\\\server\\share\\Colibri.exe')).toBe(true);
    expect(isExecutablePath('Colibri.exe')).toBe(false);           // relative
    expect(isExecutablePath('C:\\Colibri\\run.bat')).toBe(false);  // not .exe
    expect(isExecutablePath('C:\\Colibri\\')).toBe(false);
  });

  it('isValidColibriTarget = URL or exe path, never empty', () => {
    expect(isValidColibriTarget('https://colibri.app')).toBe(true);
    expect(isValidColibriTarget('C:\\Colibri\\Colibri.exe')).toBe(true);
    expect(isValidColibriTarget('')).toBe(false);
    expect(isValidColibriTarget('   ')).toBe(false);
    expect(isValidColibriTarget('ftp://x')).toBe(false);
  });
});

describe('resolveColibriLaunch', () => {
  const cfg = (enabled: boolean, target: string) => ({ enabled, target });

  it('disabled / not configured / invalid are explicit states (no false Connected)', () => {
    expect(resolveColibriLaunch(cfg(false, 'https://x.com'), true)).toEqual({ state: 'disabled' });
    expect(resolveColibriLaunch(cfg(true, ''), true)).toEqual({ state: 'not_configured' });
    expect(resolveColibriLaunch(cfg(true, 'not-a-target'), true)).toEqual({ state: 'invalid_target', raw: 'not-a-target' });
  });

  it('URL targets are ready everywhere; exe paths require the desktop channel', () => {
    expect(resolveColibriLaunch(cfg(true, 'https://colibri.app'), false))
      .toEqual({ state: 'ready', kind: 'url', target: 'https://colibri.app' });
    expect(resolveColibriLaunch(cfg(true, 'C:\\Colibri\\Colibri.exe'), true))
      .toEqual({ state: 'ready', kind: 'path', target: 'C:\\Colibri\\Colibri.exe' });
    expect(resolveColibriLaunch(cfg(true, 'C:\\Colibri\\Colibri.exe'), false))
      .toEqual({ state: 'path_needs_desktop', target: 'C:\\Colibri\\Colibri.exe' });
  });
});
