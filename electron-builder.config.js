// ============================================================
// CellHub Pro — electron-builder config (Phase 7)
// Adapted for Vite + React + TypeScript project structure
// ============================================================
module.exports = {
  appId:       'com.cellhubpro.app',
  productName: 'CellHub Pro',
  copyright:   'Copyright © 2026 CellHub Pro',

  directories: {
    output:         'dist-electron',
    buildResources: 'assets',
  },

  // Files to include in the packaged app
  files: [
    'electron/**/*',          // main.js, preload.js, license.js
    'dist-renderer/**/*',     // Vite build output
    'assets/**/*',
    'package.json',
  ],

  // Renderer build is in dist-renderer (Vite output)
  extraMetadata: {
    main: 'electron/main.js',
  },

  // ── Windows ────────────────────────────────────────────
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    icon:          'assets/icon.ico',
    publisherName: 'CellHub Pro',
  },

  nsis: {
    oneClick:                          false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut:             true,
    createStartMenuShortcut:           true,
    shortcutName:                      'CellHub Pro',
    installerIcon:                     'assets/icon.ico',
    uninstallerIcon:                   'assets/icon.ico',
    installerHeaderIcon:               'assets/icon.ico',
    // license:                        'LICENSE.txt',  // uncomment when you have one
    // installerSidebar:               'assets/installer-sidebar.bmp',
  },

  // ── macOS ──────────────────────────────────────────────
  mac: {
    target: [
      { target: 'dmg',  arch: ['x64', 'arm64'] },
      { target: 'zip',  arch: ['x64', 'arm64'] },
    ],
    icon:              'assets/icon.icns',
    category:          'public.app-category.business',
    hardenedRuntime:   true,
    gatekeeperAssess:  false,
    entitlements:        'assets/entitlements.mac.plist',
    entitlementsInherit: 'assets/entitlements.mac.plist',
  },

  dmg: {
    title:      'CellHub Pro',
    icon:       'assets/icon.icns',
    contents: [
      { x: 200, y: 190, type: 'file' },
      { x: 480, y: 190, type: 'link', path: '/Applications' },
    ],
  },

  // ── Linux ──────────────────────────────────────────────
  linux: {
    target: ['AppImage', 'deb'],
    icon:     'assets/icon.png',
    category: 'Office',
  },

  // ── Auto-update publish ────────────────────────────────
  publish: {
    provider: 'github',
    owner:    'jorgeochoa-cellhub',     // TODO: replace with real GitHub handle before release
    repo:     'cellhub-pro-releases',
    private:  true,
  },
};
