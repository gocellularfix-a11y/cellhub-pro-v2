// ============================================================
// CellHub Pro — Autocomplete data sets
// Device models, carriers, and common repair descriptions
// Optimized for a cell repair shop in Santa Barbara, CA
// ============================================================

import type { AutocompleteOption } from '@/hooks/useAutocomplete';

// ── Carriers ─────────────────────────────────────────────────
export const CARRIER_OPTIONS: AutocompleteOption[] = [
  { value: 'AT&T',              label: 'AT&T',              icon: '📡' },
  { value: 'T-Mobile',          label: 'T-Mobile',          icon: '📡' },
  { value: 'Verizon',           label: 'Verizon',           icon: '📡' },
  { value: 'Simple Mobile',     label: 'Simple Mobile',     icon: '📱' },
  { value: 'H2O',               label: 'H2O Wireless',      icon: '📱' },
  { value: 'Page Plus',         label: 'Page Plus',         icon: '📱' },
  { value: 'Cricket',           label: 'Cricket Wireless',  icon: '📱' },
  { value: 'Metro by T-Mobile', label: 'Metro by T-Mobile', icon: '📱' },
  { value: 'Boost Mobile',      label: 'Boost Mobile',      icon: '📱' },
  { value: 'Mint Mobile',       label: 'Mint Mobile',       icon: '📱' },
  { value: 'Visible',           label: 'Visible',           icon: '📱' },
  { value: 'Ultra Mobile',      label: 'Ultra Mobile',      icon: '📱' },
  { value: 'Tracfone',          label: 'Tracfone',          icon: '📱' },
  { value: 'Telcel',            label: 'Telcel',            icon: '📱' },
  { value: 'Movistar',          label: 'Movistar',          icon: '📱' },
  { value: 'Unlocked',          label: 'Unlocked',          icon: '🔓' },
  { value: 'Other',             label: 'Other / Other',     icon: '❓' },
];

// ── Phone Models ─────────────────────────────────────────────
const IPHONE_MODELS: AutocompleteOption[] = [
  // iPhone 16 series
  { value: 'iPhone 16 Pro Max', label: 'iPhone 16 Pro Max', sublabel: '2024', icon: '🍎' },
  { value: 'iPhone 16 Pro',     label: 'iPhone 16 Pro',     sublabel: '2024', icon: '🍎' },
  { value: 'iPhone 16 Plus',    label: 'iPhone 16 Plus',    sublabel: '2024', icon: '🍎' },
  { value: 'iPhone 16',         label: 'iPhone 16',         sublabel: '2024', icon: '🍎' },
  // iPhone 15 series
  { value: 'iPhone 15 Pro Max', label: 'iPhone 15 Pro Max', sublabel: '2023', icon: '🍎' },
  { value: 'iPhone 15 Pro',     label: 'iPhone 15 Pro',     sublabel: '2023', icon: '🍎' },
  { value: 'iPhone 15 Plus',    label: 'iPhone 15 Plus',    sublabel: '2023', icon: '🍎' },
  { value: 'iPhone 15',         label: 'iPhone 15',         sublabel: '2023', icon: '🍎' },
  // iPhone 14 series
  { value: 'iPhone 14 Pro Max', label: 'iPhone 14 Pro Max', sublabel: '2022', icon: '🍎' },
  { value: 'iPhone 14 Pro',     label: 'iPhone 14 Pro',     sublabel: '2022', icon: '🍎' },
  { value: 'iPhone 14 Plus',    label: 'iPhone 14 Plus',    sublabel: '2022', icon: '🍎' },
  { value: 'iPhone 14',         label: 'iPhone 14',         sublabel: '2022', icon: '🍎' },
  // iPhone 13 series
  { value: 'iPhone 13 Pro Max', label: 'iPhone 13 Pro Max', sublabel: '2021', icon: '🍎' },
  { value: 'iPhone 13 Pro',     label: 'iPhone 13 Pro',     sublabel: '2021', icon: '🍎' },
  { value: 'iPhone 13 mini',    label: 'iPhone 13 mini',    sublabel: '2021', icon: '🍎' },
  { value: 'iPhone 13',         label: 'iPhone 13',         sublabel: '2021', icon: '🍎' },
  // iPhone 12 series
  { value: 'iPhone 12 Pro Max', label: 'iPhone 12 Pro Max', sublabel: '2020', icon: '🍎' },
  { value: 'iPhone 12 Pro',     label: 'iPhone 12 Pro',     sublabel: '2020', icon: '🍎' },
  { value: 'iPhone 12 mini',    label: 'iPhone 12 mini',    sublabel: '2020', icon: '🍎' },
  { value: 'iPhone 12',         label: 'iPhone 12',         sublabel: '2020', icon: '🍎' },
  // iPhone 11 series
  { value: 'iPhone 11 Pro Max', label: 'iPhone 11 Pro Max', sublabel: '2019', icon: '🍎' },
  { value: 'iPhone 11 Pro',     label: 'iPhone 11 Pro',     sublabel: '2019', icon: '🍎' },
  { value: 'iPhone 11',         label: 'iPhone 11',         sublabel: '2019', icon: '🍎' },
  // iPhone X series
  { value: 'iPhone XS Max',     label: 'iPhone XS Max',     sublabel: '2018', icon: '🍎' },
  { value: 'iPhone XS',         label: 'iPhone XS',         sublabel: '2018', icon: '🍎' },
  { value: 'iPhone XR',         label: 'iPhone XR',         sublabel: '2018', icon: '🍎' },
  { value: 'iPhone X',          label: 'iPhone X',          sublabel: '2017', icon: '🍎' },
  // Older
  { value: 'iPhone 8 Plus',     label: 'iPhone 8 Plus',     sublabel: '2017', icon: '🍎' },
  { value: 'iPhone 8',          label: 'iPhone 8',          sublabel: '2017', icon: '🍎' },
  { value: 'iPhone 7 Plus',     label: 'iPhone 7 Plus',     sublabel: '2016', icon: '🍎' },
  { value: 'iPhone 7',          label: 'iPhone 7',          sublabel: '2016', icon: '🍎' },
  { value: 'iPhone SE (3rd)',    label: 'iPhone SE (3rd gen)', sublabel: '2022', icon: '🍎' },
  { value: 'iPhone SE (2nd)',    label: 'iPhone SE (2nd gen)', sublabel: '2020', icon: '🍎' },
];

const SAMSUNG_MODELS: AutocompleteOption[] = [
  // S series
  { value: 'Samsung Galaxy S25 Ultra',  label: 'Galaxy S25 Ultra',  sublabel: '2025', icon: '📱' },
  { value: 'Samsung Galaxy S25+',       label: 'Galaxy S25+',       sublabel: '2025', icon: '📱' },
  { value: 'Samsung Galaxy S25',        label: 'Galaxy S25',        sublabel: '2025', icon: '📱' },
  { value: 'Samsung Galaxy S24 Ultra',  label: 'Galaxy S24 Ultra',  sublabel: '2024', icon: '📱' },
  { value: 'Samsung Galaxy S24+',       label: 'Galaxy S24+',       sublabel: '2024', icon: '📱' },
  { value: 'Samsung Galaxy S24',        label: 'Galaxy S24',        sublabel: '2024', icon: '📱' },
  { value: 'Samsung Galaxy S23 Ultra',  label: 'Galaxy S23 Ultra',  sublabel: '2023', icon: '📱' },
  { value: 'Samsung Galaxy S23+',       label: 'Galaxy S23+',       sublabel: '2023', icon: '📱' },
  { value: 'Samsung Galaxy S23',        label: 'Galaxy S23',        sublabel: '2023', icon: '📱' },
  { value: 'Samsung Galaxy S22 Ultra',  label: 'Galaxy S22 Ultra',  sublabel: '2022', icon: '📱' },
  { value: 'Samsung Galaxy S22+',       label: 'Galaxy S22+',       sublabel: '2022', icon: '📱' },
  { value: 'Samsung Galaxy S22',        label: 'Galaxy S22',        sublabel: '2022', icon: '📱' },
  { value: 'Samsung Galaxy S21 Ultra',  label: 'Galaxy S21 Ultra',  sublabel: '2021', icon: '📱' },
  { value: 'Samsung Galaxy S21+',       label: 'Galaxy S21+',       sublabel: '2021', icon: '📱' },
  { value: 'Samsung Galaxy S21',        label: 'Galaxy S21',        sublabel: '2021', icon: '📱' },
  { value: 'Samsung Galaxy S20 Ultra',  label: 'Galaxy S20 Ultra',  sublabel: '2020', icon: '📱' },
  { value: 'Samsung Galaxy S20+',       label: 'Galaxy S20+',       sublabel: '2020', icon: '📱' },
  { value: 'Samsung Galaxy S20',        label: 'Galaxy S20',        sublabel: '2020', icon: '📱' },
  // A series (very common in repair shops)
  { value: 'Samsung Galaxy A55',        label: 'Galaxy A55',        sublabel: '2024', icon: '📱' },
  { value: 'Samsung Galaxy A54',        label: 'Galaxy A54',        sublabel: '2023', icon: '📱' },
  { value: 'Samsung Galaxy A53',        label: 'Galaxy A53',        sublabel: '2022', icon: '📱' },
  { value: 'Samsung Galaxy A35',        label: 'Galaxy A35',        sublabel: '2024', icon: '📱' },
  { value: 'Samsung Galaxy A34',        label: 'Galaxy A34',        sublabel: '2023', icon: '📱' },
  { value: 'Samsung Galaxy A25',        label: 'Galaxy A25',        sublabel: '2024', icon: '📱' },
  { value: 'Samsung Galaxy A24',        label: 'Galaxy A24',        sublabel: '2023', icon: '📱' },
  { value: 'Samsung Galaxy A15',        label: 'Galaxy A15',        sublabel: '2024', icon: '📱' },
  { value: 'Samsung Galaxy A14',        label: 'Galaxy A14',        sublabel: '2023', icon: '📱' },
  { value: 'Samsung Galaxy A13',        label: 'Galaxy A13',        sublabel: '2022', icon: '📱' },
  // Z series
  { value: 'Samsung Galaxy Z Fold 6',   label: 'Galaxy Z Fold 6',   sublabel: '2024', icon: '📱' },
  { value: 'Samsung Galaxy Z Flip 6',   label: 'Galaxy Z Flip 6',   sublabel: '2024', icon: '📱' },
  { value: 'Samsung Galaxy Z Fold 5',   label: 'Galaxy Z Fold 5',   sublabel: '2023', icon: '📱' },
  { value: 'Samsung Galaxy Z Flip 5',   label: 'Galaxy Z Flip 5',   sublabel: '2023', icon: '📱' },
  // Note
  { value: 'Samsung Galaxy Note 20 Ultra', label: 'Galaxy Note 20 Ultra', sublabel: '2020', icon: '📱' },
  { value: 'Samsung Galaxy Note 20',    label: 'Galaxy Note 20',    sublabel: '2020', icon: '📱' },
];

const OTHER_MODELS: AutocompleteOption[] = [
  // Google Pixel
  { value: 'Google Pixel 9 Pro XL',  label: 'Pixel 9 Pro XL',   sublabel: '2024', icon: '🤖' },
  { value: 'Google Pixel 9 Pro',     label: 'Pixel 9 Pro',      sublabel: '2024', icon: '🤖' },
  { value: 'Google Pixel 9',         label: 'Pixel 9',          sublabel: '2024', icon: '🤖' },
  { value: 'Google Pixel 8 Pro',     label: 'Pixel 8 Pro',      sublabel: '2023', icon: '🤖' },
  { value: 'Google Pixel 8',         label: 'Pixel 8',          sublabel: '2023', icon: '🤖' },
  { value: 'Google Pixel 7 Pro',     label: 'Pixel 7 Pro',      sublabel: '2022', icon: '🤖' },
  { value: 'Google Pixel 7',         label: 'Pixel 7',          sublabel: '2022', icon: '🤖' },
  { value: 'Google Pixel 6a',        label: 'Pixel 6a',         sublabel: '2022', icon: '🤖' },
  // Motorola
  { value: 'Motorola Moto G Power',  label: 'Moto G Power',     sublabel: 'Motorola', icon: '📱' },
  { value: 'Motorola Moto G Play',   label: 'Moto G Play',      sublabel: 'Motorola', icon: '📱' },
  { value: 'Motorola Edge 50',       label: 'Moto Edge 50',     sublabel: 'Motorola', icon: '📱' },
  { value: 'Motorola Edge 40',       label: 'Moto Edge 40',     sublabel: 'Motorola', icon: '📱' },
  { value: 'Motorola Razr 50',       label: 'Motorola Razr 50', sublabel: '2024', icon: '📱' },
  // LG
  { value: 'LG Stylo 6',            label: 'LG Stylo 6',       sublabel: 'LG', icon: '📱' },
  { value: 'LG V60',                label: 'LG V60',           sublabel: 'LG', icon: '📱' },
  { value: 'LG K51',                label: 'LG K51',           sublabel: 'LG', icon: '📱' },
  // OnePlus
  { value: 'OnePlus 12',            label: 'OnePlus 12',       sublabel: '2024', icon: '📱' },
  { value: 'OnePlus 11',            label: 'OnePlus 11',       sublabel: '2023', icon: '📱' },
  // Tablets
  { value: 'iPad Pro 13"',          label: 'iPad Pro 13"',     sublabel: '2024', icon: '📲' },
  { value: 'iPad Pro 11"',          label: 'iPad Pro 11"',     sublabel: '2024', icon: '📲' },
  { value: 'iPad Air',              label: 'iPad Air',         sublabel: 'Apple', icon: '📲' },
  { value: 'iPad mini',             label: 'iPad mini',        sublabel: 'Apple', icon: '📲' },
  { value: 'iPad (10th gen)',        label: 'iPad (10th gen)',  sublabel: '2022', icon: '📲' },
  { value: 'Samsung Galaxy Tab S9', label: 'Galaxy Tab S9',    sublabel: 'Samsung', icon: '📲' },
  { value: 'Samsung Galaxy Tab A9', label: 'Galaxy Tab A9',    sublabel: 'Samsung', icon: '📲' },
];

export const DEVICE_MODEL_OPTIONS: AutocompleteOption[] = [
  ...IPHONE_MODELS,
  ...SAMSUNG_MODELS,
  ...OTHER_MODELS,
];

// ── Common repair issues (for issue textarea) ─────────────────
export const REPAIR_ISSUE_OPTIONS: AutocompleteOption[] = [
  { value: 'Cracked / broken screen',                icon: '📱', label: 'Cracked / broken screen' },
  { value: 'Battery not charging / drains fast',      icon: '🔋', label: 'Battery not charging / drains fast' },
  { value: 'Water / liquid damage',                   icon: '💧', label: 'Water / liquid damage' },
  { value: 'Charging port not working',               icon: '🔌', label: 'Charging port not working' },
  { value: 'No sound / speaker not working',          icon: '🔇', label: 'No sound / speaker not working' },
  { value: 'Camera not working / blurry photos',      icon: '📷', label: 'Camera not working / blurry photos' },
  { value: 'No signal / not connecting to network',   icon: '📶', label: 'No signal / not connecting to network' },
  { value: "Won't turn on / black screen",            icon: '🖥️', label: "Won't turn on / black screen" },
  { value: 'WiFi or Bluetooth not working',           icon: '📡', label: 'WiFi or Bluetooth not working' },
  { value: 'Account unlock / iCloud / FRP bypass',   icon: '🔑', label: 'Account unlock / iCloud / FRP bypass' },
  { value: 'Microphone not working',                  icon: '🎤', label: 'Microphone not working' },
  { value: 'General device diagnostic',               icon: '🔧', label: 'General device diagnostic' },
  { value: 'Buttons not responding (power/volume)',   icon: '🔘', label: 'Buttons not responding (power/volume)' },
  { value: 'Phone overheating',                       icon: '🌡️', label: 'Phone overheating' },
  { value: 'Back glass cracked',                      icon: '📱', label: 'Back glass cracked' },
  { value: 'Earpiece not working',                    icon: '👂', label: 'Earpiece not working' },
  { value: 'Face ID / Touch ID not working',          icon: '🪪', label: 'Face ID / Touch ID not working' },
  { value: 'SIM card not reading',                    icon: '💳', label: 'SIM card not reading' },
  { value: 'Software restore / OS update',            icon: '⚙️', label: 'Software restore / OS update' },
  { value: 'Storage full — need to free space',       icon: '💾', label: 'Storage full — need to free space' },
];
