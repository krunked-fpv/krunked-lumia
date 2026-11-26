import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_TRACK_IDS,
  ARR_MOVE_SPEED_NAMES,
  ARR_MOVE_SPEED_TICKS,
  AUTOMATA_DECAY,
  BLOCKS_PER_LEVEL,
  BLOOM_BASE_INTENSITY,
  BLOOM_BLUR_SIGMA,
  BLOOM_BLUR_STEPS,
  BLOOM_LUMA_WEIGHTS,
  BOARD_HEIGHT,
  BOARD_SHAKE_DECAY,
  BOARD_WIDTH,
  CONTAINER_HEIGHT,
  CONTAINER_WIDTH,
  FALL_SPEED_TICKS,
  GAME_MODE_ORDER,
  IMPOSSIBLE_DROP_TIMER_TICKS,
  IMPOSSIBLE_LEVEL_BONUS,
  IMPOSSIBLE_UNLOCK_SCORE,
  LIGHT_PALETTE_LUMA_THRESHOLD,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  MARATHON_TARGET_BLOCKS,
  MAX_COMBO_MULTIPLIER,
  MODE_COUNT,
  PALETTE_COUNT,
  PERFECT_CLEAR_BASE_BONUS,
  ROOM_LAYER_ORDER,
  RUSH_DURATION_MS,
  RUSH_TRACK_POOL,
  SIM_HZ,
  SLACK_DURATION_TICKS,
  SLACK_MAX_IMPOSSIBLE,
  SLACK_MAX_STANDARD,
  STANDARD_TRACK_POOL,
  TRACK_COUNT,
} from '../src/contracts/index.js';

const RETAIL_DIR = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Mixolumia';
const OUT_DIR = path.resolve(process.cwd(), '.lumia-assets');
const OUT_FILE = path.join(OUT_DIR, 'oracle.json');

interface ProvenanceValue<T> {
  value: T;
  provenance: 'extracted' | 'measured';
  source: string;
}

function tag<T>(value: T, provenance: 'extracted' | 'measured', source: string): ProvenanceValue<T> {
  return { value, provenance, source };
}

function inspectRetailCounts(): {
  retailAvailable: boolean;
  palettesIniCount: number | null;
  tracklistStandard: string[] | null;
  tracklistRush: string[] | null;
  dataWinBytes: number | null;
  shaderCount: number | null;
} {
  if (!fs.existsSync(RETAIL_DIR)) {
    return {
      retailAvailable: false,
      palettesIniCount: null,
      tracklistStandard: null,
      tracklistRush: null,
      dataWinBytes: null,
      shaderCount: null,
    };
  }

  let palettesIniCount: number | null = null;
  const palettesPath = path.join(RETAIL_DIR, 'data', 'palettes.ini');
  if (fs.existsSync(palettesPath)) {
    const raw = fs.readFileSync(palettesPath, 'utf8');
    const matches = raw.match(/^\[\d+\]/gm);
    palettesIniCount = matches ? matches.length : 0;
  }

  let tracklistStandard: string[] | null = null;
  let tracklistRush: string[] | null = null;
  const tracklistPath = path.join(RETAIL_DIR, 'data', 'tracklist.json');
  if (fs.existsSync(tracklistPath)) {
    const raw = fs.readFileSync(tracklistPath, 'utf8').replace(/,\s*([}\]])/g, '$1');
    const parsed = JSON.parse(raw) as { standard?: string[]; rush?: string[] };
    tracklistStandard = parsed.standard ?? null;
    tracklistRush = parsed.rush ?? null;
  }

  let dataWinBytes: number | null = null;
  let shaderCount: number | null = null;
  const dataWinPath = path.join(RETAIL_DIR, 'data.win');
  if (fs.existsSync(dataWinPath)) {
    const buf = fs.readFileSync(dataWinPath);
    dataWinBytes = buf.length;
    let off = 8;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const len = buf.readUInt32LE(off + 4);
      if (id === 'SHDR') {
        shaderCount = buf.readUInt32LE(off + 8);
        break;
      }
      off += 8 + len;
    }
  }

  return {
    retailAvailable: true,
    palettesIniCount,
    tracklistStandard,
    tracklistRush,
    dataWinBytes,
    shaderCount,
  };
}

function main(): void {
  const retail = inspectRetailCounts();

  const oracle = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    retailSnapshot: retail,
    constants: {
      simHz: tag(SIM_HZ, 'extracted', 'data.win GEN8 room speed 60 Hz'),
      logicalViewport: tag(
        { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT },
        'extracted',
        'data.win ROOM viewport 320x180',
      ),
      containerDimensions: tag(
        { width: CONTAINER_WIDTH, height: CONTAINER_HEIGHT },
        'extracted',
        'data.win SPRT container_spr 68x128',
      ),
      boardDimensions: tag(
        { width: BOARD_WIDTH, height: BOARD_HEIGHT },
        'extracted',
        'Mixolumia.exe format_board 8x29',
      ),
      roomLayerOrder: tag([...ROOM_LAYER_ORDER], 'extracted', 'data.win ROOM layer stack'),
      fallSpeedTicks: tag([...FALL_SPEED_TICKS], 'extracted', 'Mixolumia.exe fall_spd[0..15]'),
      impossibleDropTimerTicks: tag(
        [...IMPOSSIBLE_DROP_TIMER_TICKS],
        'extracted',
        'Mixolumia.exe impossible_drop_timer[0..16]',
      ),
      arrMoveSpeedTicks: tag([...ARR_MOVE_SPEED_TICKS], 'extracted', 'Mixolumia.exe move_spd[0..5]'),
      arrMoveSpeedNames: tag([...ARR_MOVE_SPEED_NAMES], 'extracted', 'data/localization/en_us.csv'),
      slackDurationTicks: tag(SLACK_DURATION_TICKS, 'extracted', 'Mixolumia.exe slack_t = 12'),
      slackMaxStandard: tag(SLACK_MAX_STANDARD, 'extracted', 'Mixolumia.exe slack_count = 10'),
      slackMaxImpossible: tag(SLACK_MAX_IMPOSSIBLE, 'extracted', 'Mixolumia.exe impossible slack_count = 4'),
      blocksPerLevel: tag(BLOCKS_PER_LEVEL, 'extracted', 'Mixolumia.exe floor(cleared / 30)'),
      marathonTargetBlocks: tag(MARATHON_TARGET_BLOCKS, 'extracted', 'Mixolumia.exe 450 block goal'),
      rushDurationMs: tag(RUSH_DURATION_MS, 'extracted', 'Mixolumia.exe 120000 ms Rush timer'),
      impossibleUnlockScore: tag(IMPOSSIBLE_UNLOCK_SCORE, 'extracted', 'Mixolumia.exe 4000000 unlock'),
      impossibleLevelBonus: tag(IMPOSSIBLE_LEVEL_BONUS, 'extracted', 'Mixolumia.exe +15 level multiplier'),
      maxComboMultiplier: tag(MAX_COMBO_MULTIPLIER, 'extracted', 'Mixolumia.exe min(combo, 4)'),
      perfectClearBaseBonus: tag(PERFECT_CLEAR_BASE_BONUS, 'extracted', 'Mixolumia.exe 10000*(effLevel+1)*comboMult'),
      boardShakeDecay: tag(BOARD_SHAKE_DECAY, 'extracted', 'Mixolumia.exe board_offset *= 0.916'),
      automataDecay: tag(AUTOMATA_DECAY, 'extracted', 'Mixolumia.exe automata_grid *= 0.75'),
      bloomBaseIntensity: tag(BLOOM_BASE_INTENSITY, 'extracted', 'Mixolumia.exe bloom_intensity = 0.15'),
      bloomLumaWeights: tag([...BLOOM_LUMA_WEIGHTS], 'extracted', 'data.win SHDR bloom_filter_luminance_shd'),
      bloomBlurSteps: tag(BLOOM_BLUR_STEPS, 'extracted', 'data.win SHDR blur_2_pass_gauss_lerp_shd'),
      bloomBlurSigma: tag(BLOOM_BLUR_SIGMA, 'extracted', 'data.win SHDR blur_2_pass_gauss_lerp_shd'),
      lightPaletteLumaThreshold: tag(
        LIGHT_PALETTE_LUMA_THRESHOLD,
        'extracted',
        'Mixolumia.exe blend_darken threshold > 128',
      ),
      modes: tag([...GAME_MODE_ORDER], 'extracted', 'Mixolumia.exe 6 modes'),
      modeCount: tag(MODE_COUNT, 'extracted', 'Mixolumia.exe 6 modes'),
      paletteCount: tag(
        retail.palettesIniCount ?? PALETTE_COUNT,
        retail.palettesIniCount !== null ? 'measured' : 'extracted',
        'data/palettes.ini',
      ),
      trackCount: tag(TRACK_COUNT, 'extracted', 'data/tracklist.json + data/music/*'),
      standardTrackPool: tag(
        retail.tracklistStandard ?? [...STANDARD_TRACK_POOL],
        retail.tracklistStandard ? 'measured' : 'extracted',
        'data/tracklist.json standard',
      ),
      rushTrackPool: tag(
        retail.tracklistRush ?? [...RUSH_TRACK_POOL],
        retail.tracklistRush ? 'measured' : 'extracted',
        'data/tracklist.json rush',
      ),
      allTrackIds: tag([...ALL_TRACK_IDS], 'extracted', 'data/music/*'),
      shaders: tag(
        [
          'bloom_filter_luminance_shd',
          'blur_2_pass_gauss_lerp_shd',
          'blend_darken_shd',
          'color_threshold_shd',
        ],
        'extracted',
        'data.win SHDR chunk',
      ),
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(oracle, null, 2) + '\n', 'utf8');
  console.log(`[oracle-dump] Wrote ${OUT_FILE} (retailAvailable=${retail.retailAvailable})`);
}

main();
