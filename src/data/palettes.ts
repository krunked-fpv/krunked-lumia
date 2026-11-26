/**
 * Krunked Lumia — 63 Built-In 6-Color Palettes, INI Parser & Share Codes
 *
 * Slot Contract:
 *   [0] Background
 *   [1] Game Board Interior
 *   [2] Empty Block (1) & Primary UI Text
 *   [3] Filled Block (2) & Selected UI Text / Accent
 *   [4] Hole Block (3)
 *   [5] Target Block (4)
 */

import {
  isLightPaletteBg,
  PALETTE_COUNT,
  type Palette,
  type PaletteColors,
} from '../contracts/index.js';

export { PALETTE_COUNT };
export type { Palette, PaletteColors };

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

function makePalette(
  id: string,
  name: string,
  colors: PaletteColors,
  author = 'Krunked Foundry',
): Palette {
  return {
    id,
    name,
    author,
    colors,
    isCustom: false,
  };
}

/**
 * All 63 built-in 6-color palettes.
 * Indices 0..4 match the iconic dark/light foundation palettes;
 * indices 5..62 deliver 58 original dark & light Krunked colorways.
 */
export const BUILTIN_PALETTES: readonly Palette[] = [
  // 0..4 — Signature Foundation Palettes
  makePalette('pico_dark', 'Pico Dark', [
    '#000000', '#1d2b53', '#fff7f2', '#ffec27', '#29adff', '#ff004d',
  ]),
  makePalette('pico_light', 'Pico Light', [
    '#fff1e8', '#f0d4d3', '#1d2b53', '#ffa300', '#29adff', '#ff004d',
  ]),
  makePalette('caprese', 'Caprese', [
    '#1b2b34', '#343d46', '#cdd3de', '#99c794', '#ec5f67', '#fac863',
  ]),
  makePalette('calm', 'Calm', [
    '#fbe8cf', '#f0dcc5', '#b0a291', '#4d7167', '#019bbd', '#fe6f63',
  ]),
  makePalette('ultraviolet', 'Ultraviolet', [
    '#0c0616', '#200346', '#cd00ff', '#5900a6', '#9b59ff', '#fcd3ff',
  ]),

  // 5..14 — Retro Handheld & Arcade CRT
  makePalette('pocket_olive', 'Pocket Olive', [
    '#0f380f', '#1d4d1d', '#e0f8d0', '#8bac0f', '#c4f0c2', '#528030',
  ]),
  makePalette('dmg_cream', 'DMG Cream', [
    '#e4ecd8', '#cad6b8', '#1c301c', '#587838', '#30542c', '#88a850',
  ]),
  makePalette('phosphor_crt', 'Phosphor CRT', [
    '#041108', '#0c2414', '#c8ffd4', '#33ff66', '#00cc99', '#99ff33',
  ]),
  makePalette('amber_terminal', 'Amber Terminal', [
    '#120a02', '#261708', '#ffdfa0', '#ffb000', '#ff6a00', '#ffe875',
  ]),
  makePalette('cobalt_monitor', 'Cobalt Monitor', [
    '#050b18', '#0f1e3a', '#d8f0ff', '#38b6ff', '#7c8cff', '#00e5c0',
  ]),
  makePalette('virtual_ruby', 'Virtual Ruby', [
    '#110205', '#290710', '#ffd6de', '#ff1e4d', '#ff6b6b', '#ff9e7d',
  ]),
  makePalette('arcade_cabinet', 'Arcade Cabinet', [
    '#0a0c1c', '#181e3c', '#f5f7ff', '#ffd60a', '#00d9ff', '#ff2e88',
  ]),
  makePalette('lynx_dusk', 'Lynx Dusk', [
    '#191624', '#2c263f', '#f2e9e4', '#f7b267', '#56cfe1', '#f25c54',
  ]),
  makePalette('wonder_chalk', 'Wonder Chalk', [
    '#eef1f5', '#dae0e8', '#222836', '#e63946', '#2a9d8f', '#f4a261',
  ]),
  makePalette('famicom_gold', 'Famicom Gold', [
    '#200b10', '#3a141d', '#fff3d6', '#e6b84c', '#e6482e', '#69c2b0',
  ]),

  // 15..24 — Neon, Synthwave & Cyberpunk
  makePalette('outrun_pulse', 'Outrun Pulse', [
    '#0d0620', '#1d1042', '#fdf2ff', '#ff3cac', '#00f5d4', '#ffd23f',
  ]),
  makePalette('vapor_dusk', 'Vapor Dusk', [
    '#1a142e', '#2d234d', '#f0e7ff', '#ff70a6', '#70d6ff', '#ffd670',
  ]),
  makePalette('cyber_lime', 'Cyber Lime', [
    '#0a0e0f', '#172226', '#ecfff2', '#b8ff00', '#00e5ff', '#ff2a85',
  ]),
  makePalette('laser_magenta', 'Laser Magenta', [
    '#140614', '#2b0d2c', '#ffe8fa', '#ff29c3', '#4df0ff', '#ffbe0b',
  ]),
  makePalette('neon_tokyo', 'Neon Tokyo', [
    '#090b16', '#161b33', '#edf2ff', '#ff2e63', '#08d9d6', '#f9ed69',
  ]),
  makePalette('plasma_forge', 'Plasma Forge', [
    '#120918', '#251332', '#ffeef2', '#ff6d00', '#00e5ff', '#ff006e',
  ]),
  makePalette('hyper_cyan', 'Hyper Cyan', [
    '#04131c', '#0b2838', '#e6fbff', '#00f0ff', '#ff5e7e', '#ffe66d',
  ]),
  makePalette('synth_coral', 'Synth Coral', [
    '#171024', '#291d3d', '#fff0eb', '#ff6f59', '#43aa8b', '#f9c74f',
  ]),
  makePalette('midnight_prism', 'Midnight Prism', [
    '#070913', '#13182e', '#eef4ff', '#6c63ff', '#00d2a0', '#ff6584',
  ]),
  makePalette('voltage_spark', 'Voltage Spark', [
    '#101116', '#20232e', '#f7f8fc', '#f5e642', '#3bd6ff', '#ff4d6d',
  ]),

  // 25..36 — Light, Porcelain & Pastel Ink-Bloom Themes
  makePalette('alabaster_mint', 'Alabaster Mint', [
    '#f4f9f6', '#dfece4', '#1a352c', '#209e75', '#d9534f', '#e0911b',
  ]),
  makePalette('peach_sorbet', 'Peach Sorbet', [
    '#fff2e6', '#f5dec9', '#3d2520', '#e85d4a', '#2b8a9e', '#d9981e',
  ]),
  makePalette('porcelain_ink', 'Porcelain Ink', [
    '#f6f5f0', '#e3e0d5', '#1d2432', '#2667ff', '#d6325b', '#009e73',
  ]),
  makePalette('daylight_sky', 'Daylight Sky', [
    '#edf6fc', '#d4e7f5', '#152c44', '#1c7ed6', '#e8590c', '#2b9348',
  ]),
  makePalette('matcha_paper', 'Matcha Paper', [
    '#f3f5e8', '#dfe4cc', '#25331d', '#5f8d37', '#c8553d', '#2d7d90',
  ]),
  makePalette('cotton_cloud', 'Cotton Cloud', [
    '#fdf4f8', '#f0dce6', '#332036', '#d6458f', '#2f8fd4', '#e08e26',
  ]),
  makePalette('linen_sepia', 'Linen Sepia', [
    '#f7f0e4', '#e6dac6', '#3a2d21', '#a65d2e', '#3c7a72', '#b83b4d',
  ]),
  makePalette('lemon_zest', 'Lemon Zest', [
    '#fdfbe7', '#f0ebc8', '#2e2b18', '#d97706', '#2563eb', '#dc2626',
  ]),
  makePalette('sakura_mist', 'Sakura Mist', [
    '#fff0f3', '#f4d6de', '#3a1d2b', '#d9386b', '#4d7c8a', '#e38b29',
  ]),
  makePalette('nordic_snow', 'Nordic Snow', [
    '#eceff4', '#d8dee9', '#2e3440', '#5e81ac', '#bf616a', '#a3be8c',
  ]),
  makePalette('citrus_chalk', 'Citrus Chalk', [
    '#f7f9f2', '#e4ebd8', '#222b24', '#e06d1b', '#1b8a99', '#c92a54',
  ]),
  makePalette('paper_blueprint', 'Paper Blueprint', [
    '#eef4ff', '#d6e4ff', '#10254a', '#245ce6', '#d9385a', '#0c8f78',
  ]),

  // 37..48 — Classic Dev, Solarized & Minimalist Palettes
  makePalette('solar_dark', 'Solar Dark', [
    '#002b36', '#073642', '#eee8d5', '#b58900', '#2aa198', '#dc322f',
  ]),
  makePalette('solar_light', 'Solar Light', [
    '#fdf6e3', '#eee8d5', '#073642', '#cb4b16', '#268bd2', '#859900',
  ]),
  makePalette('nord_frost', 'Nord Frost', [
    '#242933', '#2e3440', '#eceff4', '#88c0d0', '#ebcb8b', '#bf616a',
  ]),
  makePalette('gruv_warm', 'Gruv Warm', [
    '#1d2021', '#282828', '#ebdbb2', '#fabd2f', '#83a598', '#fb4934',
  ]),
  makePalette('gruv_cream', 'Gruv Cream', [
    '#fbf1c7', '#ebdbb2', '#282828', '#d79921', '#458588', '#cc241d',
  ]),
  makePalette('velvet_night', 'Velvet Night', [
    '#1e1f29', '#282a36', '#f8f8f2', '#bd93f9', '#50fa7b', '#ff79c6',
  ]),
  makePalette('monokai_prism', 'Monokai Prism', [
    '#1c1d19', '#272822', '#f8f8f2', '#a6e22e', '#66d9ef', '#f92672',
  ]),
  makePalette('mocha_dusk', 'Mocha Dusk', [
    '#181825', '#242438', '#cdd6f4', '#f9e2af', '#89b4fa', '#f38ba8',
  ]),
  makePalette('latte_morning', 'Latte Morning', [
    '#eff1f5', '#dce0e8', '#33364a', '#df8e1d', '#1e66f5', '#d20f39',
  ]),
  makePalette('rose_pine', 'Rose Pine', [
    '#191724', '#26233a', '#e0def4', '#f6c177', '#9ccfd8', '#eb6f92',
  ]),
  makePalette('dawn_pine', 'Dawn Pine', [
    '#faf4ed', '#ede5dc', '#383452', '#d7827e', '#286983', '#ea9d34',
  ]),
  makePalette('ink_wave', 'Ink Wave', [
    '#16161d', '#242430', '#dcd7ba', '#e6c384', '#7e9cd8', '#e46876',
  ]),

  // 49..57 — Nature, Botanical & Oceanic
  makePalette('pine_canopy', 'Pine Canopy', [
    '#0d1b16', '#183027', '#e6f5ec', '#7ae582', '#38b6b0', '#f4d35e',
  ]),
  makePalette('terracotta_sun', 'Terracotta Sun', [
    '#231712', '#3b261e', '#f7ebe1', '#e76f51', '#2a9d8f', '#e9c46a',
  ]),
  makePalette('deep_trench', 'Deep Trench', [
    '#04111c', '#0a2236', '#d9f2ff', '#00b4d8', '#90e0ef', '#ff758f',
  ]),
  makePalette('coral_reef', 'Coral Reef', [
    '#0c2233', '#163852', '#f2fbff', '#ff6b6b', '#4ecdc4', '#ffe66d',
  ]),
  makePalette('autumn_cider', 'Autumn Cider', [
    '#1f130d', '#362117', '#fcebd9', '#f28c28', '#d9483b', '#8ab17d',
  ]),
  makePalette('arctic_glacier', 'Arctic Glacier', [
    '#e8f4f8', '#cde5ee', '#132a3e', '#0077b6', '#e63946', '#2a9d8f',
  ]),
  makePalette('desert_mirage', 'Desert Mirage', [
    '#f5e6d3', '#e5cfba', '#3b261d', '#c85a32', '#267871', '#d99f26',
  ]),
  makePalette('lavender_field', 'Lavender Field', [
    '#f3effa', '#e0d6f0', '#2b1e42', '#7b4cd9', '#2b9eb3', '#e05780',
  ]),
  makePalette('moss_and_clay', 'Moss And Clay', [
    '#19211b', '#2a362d', '#e9efe6', '#a3c962', '#e07a5f', '#64b6ac',
  ]),

  // 58..62 — High-Contrast Monochrome & Jewel
  makePalette('mono_noir', 'Mono Noir', [
    '#000000', '#1c1c1c', '#ffffff', '#cccccc', '#8c8c8c', '#595959',
  ]),
  makePalette('mono_paper', 'Mono Paper', [
    '#ffffff', '#e6e6e6', '#111111', '#444444', '#777777', '#a6a6a6',
  ]),
  makePalette('obsidian_gold', 'Obsidian Gold', [
    '#0b0a0e', '#1b1822', '#fff8e7', '#f5c542', '#4fd1c5', '#ff5964',
  ]),
  makePalette('emerald_vault', 'Emerald Vault', [
    '#061712', '#0f2e24', '#e8fff5', '#10b981', '#38bdf8', '#fbbf24',
  ]),
  makePalette('crimson_velvet', 'Crimson Velvet', [
    '#17070c', '#2e1019', '#ffedf2', '#ff4d6d', '#ffd166', '#5ce1e6',
  ]),
];

/**
 * Normalize a hex string (with or without leading `#`, quotes, or uppercase)
 * into strict lowercase `#rrggbb`, or `null` if invalid.
 */
export function normalizeHexColor(raw: string): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const stripped = raw.trim().replace(/^["']|["']$/g, '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(stripped)) {
    return null;
  }
  return `#${stripped.toLowerCase()}`;
}

/**
 * Type guard checking whether a value is a valid 6-slot lowercase `#rrggbb` array.
 */
export function isValidPaletteColors(value: unknown): value is PaletteColors {
  if (!Array.isArray(value) || value.length !== 6) {
    return false;
  }
  return value.every((slot) => typeof slot === 'string' && HEX_COLOR_RE.test(slot));
}

/**
 * Normalize a 6-element color array to lowercase `#rrggbb` strings, or return null.
 */
export function normalizePaletteColors(value: unknown): PaletteColors | null {
  if (!Array.isArray(value) || value.length !== 6) {
    return null;
  }
  const normalized: string[] = [];
  for (let i = 0; i < 6; i++) {
    const hex = normalizeHexColor(value[i] as string);
    if (!hex) {
      return null;
    }
    normalized.push(hex);
  }
  return normalized as PaletteColors;
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function unquoteIniValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function mapIniColorSlot(key: string): number {
  const k = key.toLowerCase();
  if (/^[0-5]$/.test(k)) return Number(k);
  const prefixed = k.match(/^(?:c|col|color|slot)_?([0-5])$/);
  if (prefixed) return Number(prefixed[1]);
  if (k === 'bg' || k === 'background') return 0;
  if (k === 'board' || k === 'container') return 1;
  if (k === 'empty' || k === 'text') return 2;
  if (k === 'filled' || k === 'accent') return 3;
  if (k === 'hole') return 4;
  if (k === 'target') return 5;
  return -1;
}

/**
 * Parses retail `palettes.ini` (`[0]`..`[62]`) into normalized `Palette[]`.
 * Handles quoted & unquoted values, optional leading `#`, uppercase hex,
 * comments (`;` or `#`), and skips incomplete/malformed sections cleanly.
 */
export function parsePalettesIni(iniText: string): Palette[] {
  if (typeof iniText !== 'string' || !iniText.trim()) {
    return [];
  }

  interface IniSection {
    header: string;
    name: string;
    author?: string;
    slots: (string | null)[];
  }

  const sections: IniSection[] = [];
  let current: IniSection | null = null;
  const lines = iniText.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = {
        header: sectionMatch[1].trim(),
        name: '',
        slots: [null, null, null, null, null, null],
      };
      sections.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    const val = unquoteIniValue(line.slice(eqIdx + 1));
    const lowerKey = key.toLowerCase();

    if (lowerKey === 'name' || lowerKey === 'title') {
      current.name = val;
      continue;
    }

    if (lowerKey === 'author' || lowerKey === 'creator') {
      if (val) {
        current.author = val;
      }
      continue;
    }

    if (lowerKey === 'colors') {
      const parts = val.split(/[,\s]+/).filter(Boolean);
      if (parts.length === 6) {
        for (let i = 0; i < 6; i++) {
          current.slots[i] = normalizeHexColor(parts[i]);
        }
      }
      continue;
    }

    const slotIdx = mapIniColorSlot(key);
    if (slotIdx >= 0 && slotIdx < 6) {
      current.slots[slotIdx] = normalizeHexColor(val);
    }
  }

  const usedIds = new Set<string>();
  const palettes: Palette[] = [];

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.slots.some((slot) => slot === null)) {
      continue;
    }
    const displayName = sec.name || `Palette ${sec.header}`;
    const baseId = `ini_${slugify(sec.header, String(i))}_${slugify(displayName, 'palette')}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}_${suffix++}`;
    }
    usedIds.add(id);

    palettes.push({
      id,
      name: displayName,
      ...(sec.author ? { author: sec.author } : {}),
      colors: sec.slots as PaletteColors,
      isCustom: false,
    });
  }

  return palettes;
}

/**
 * Encodes a palette into a compact 36-hex-char share code, optionally prefixed with `name:`.
 */
export function encodePaletteShareCode(palette: Palette, includeName = false): string {
  const hex36 = palette.colors
    .map((color) => {
      const norm = normalizeHexColor(color);
      return (norm ?? '#000000').slice(1);
    })
    .join('');

  if (includeName && palette.name.trim()) {
    const safeName = palette.name.trim().replace(/:/g, '').slice(0, 32);
    if (safeName) {
      return `${safeName}:${hex36}`;
    }
  }
  return hex36;
}

/**
 * Decodes a palette share code (`36hex` or `name:36hex`, tolerant of `#`, spaces, commas, hyphens)
 * into both optional `name` and normalized 6-slot `PaletteColors`, or `null` if invalid.
 */
export function decodePaletteShareEntry(
  code: string,
): { name: string | null; colors: PaletteColors } | null {
  if (typeof code !== 'string') {
    return null;
  }
  const trimmed = code.trim();
  if (!trimmed) {
    return null;
  }

  let name: string | null = null;
  let hexPayload = trimmed;

  const colonIdx = trimmed.lastIndexOf(':');
  if (colonIdx !== -1) {
    const candidateName = trimmed.slice(0, colonIdx).trim();
    name = candidateName.length > 0 ? candidateName.slice(0, 32) : null;
    hexPayload = trimmed.slice(colonIdx + 1).trim();
  }

  const compactHex = hexPayload.replace(/[#,\s_-]+/g, '');
  if (!/^[0-9a-fA-F]{36}$/.test(compactHex)) {
    return null;
  }

  const lower = compactHex.toLowerCase();
  const colors: PaletteColors = [
    `#${lower.slice(0, 6)}`,
    `#${lower.slice(6, 12)}`,
    `#${lower.slice(12, 18)}`,
    `#${lower.slice(18, 24)}`,
    `#${lower.slice(24, 30)}`,
    `#${lower.slice(30, 36)}`,
  ];

  return { name, colors };
}

/**
 * Decodes a compact 36-hex-char share code (with optional `name:` prefix) into 6 lowercase `#rrggbb` colors.
 */
export function decodePaletteShareCode(code: string): PaletteColors | null {
  const decoded = decodePaletteShareEntry(code);
  return decoded ? decoded.colors : null;
}

/**
 * Safely looks up a palette by ID across the supplied list (and built-in fallback),
 * defaulting to `pico_dark` (`BUILTIN_PALETTES[0]`) if not found.
 */
export function getPaletteById(
  id: string,
  allPalettes: readonly Palette[] = BUILTIN_PALETTES,
): Palette {
  const fromAll = allPalettes.find((palette) => palette.id === id);
  if (fromAll) {
    return fromAll;
  }
  const fromBuiltin = BUILTIN_PALETTES.find((palette) => palette.id === id);
  if (fromBuiltin) {
    return fromBuiltin;
  }
  return BUILTIN_PALETTES[0];
}

export function getDefaultPalette(): Palette {
  return BUILTIN_PALETTES[0];
}

export function isPaletteLight(palette: Pick<Palette, 'colors'>): boolean {
  return isLightPaletteBg(palette.colors[0]);
}
