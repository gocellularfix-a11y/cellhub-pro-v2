/**
 * R-DESKTOP-LICENSE-V1-SCAFFOLD
 *
 * Desktop installation identity — persists a stable storeId, a
 * desktopDeviceId (UUID, generated once on first init), and an
 * installationId (UUID, generated once) in localStorage.
 *
 * Identity only — no license enforcement yet. This scaffold makes the
 * IDs available for bridge auth and future license checks without
 * locking anything down.
 */

const STORAGE_KEY = 'cellhub.desktop.identity.v1';

export interface DesktopIdentity {
  storeId: string;
  desktopDeviceId: string;
  installationId: string;
  licenseKey?: string;
  activatedAt?: string;
  updatedAt: string;
}

export interface InitDesktopIdentityInput {
  storeId: string;
  licenseKey?: string;
}

function readRaw(): DesktopIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DesktopIdentity;
  } catch {
    return null;
  }
}

function writeRaw(identity: DesktopIdentity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

/** Returns the stored identity, or null if not yet initialised. */
export function getDesktopIdentity(): DesktopIdentity | null {
  return readRaw();
}

/** True when a valid identity record exists in storage. */
export function hasDesktopIdentity(): boolean {
  return readRaw() !== null;
}

/**
 * True when the app is running as a desktop (Electron) build AND no
 * identity has been stored yet. Used to gate a first-run setup prompt.
 */
export function isDesktopSetupRequired(): boolean {
  if (typeof window === 'undefined') return false;
  const isElectronEnv = !!(window as unknown as { api?: unknown }).api;
  return isElectronEnv && !hasDesktopIdentity();
}

/**
 * Create the identity record on first run. Safe to call multiple times —
 * if an identity already exists the storeId is updated and licenseKey is
 * merged, but desktopDeviceId and installationId are NEVER regenerated.
 */
export function initializeDesktopIdentity(input: InitDesktopIdentityInput): DesktopIdentity {
  const existing = readRaw();
  const now = new Date().toISOString();

  if (existing) {
    const updated: DesktopIdentity = {
      ...existing,
      storeId: input.storeId,
      ...(input.licenseKey ? { licenseKey: input.licenseKey } : {}),
      updatedAt: now,
    };
    writeRaw(updated);
    return updated;
  }

  const identity: DesktopIdentity = {
    storeId: input.storeId,
    desktopDeviceId: crypto.randomUUID(),
    installationId: crypto.randomUUID(),
    ...(input.licenseKey ? { licenseKey: input.licenseKey } : {}),
    updatedAt: now,
  };
  writeRaw(identity);
  return identity;
}

/** Merge a partial patch into the existing identity. No-op if not initialised. */
export function updateDesktopIdentity(patch: Partial<Omit<DesktopIdentity, 'desktopDeviceId' | 'installationId'>>): DesktopIdentity | null {
  const existing = readRaw();
  if (!existing) return null;
  const updated: DesktopIdentity = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  writeRaw(updated);
  return updated;
}

/** DEV ONLY — wipe identity so first-run flow can be re-triggered. */
export function resetDesktopIdentityForDevOnly(): void {
  localStorage.removeItem(STORAGE_KEY);
}
