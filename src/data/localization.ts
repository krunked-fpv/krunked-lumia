/**
 * Krunked Lumia — en_us Localization Dictionary & RFC-4180 CSV Parser
 * 100% original Krunked Lumia copy across all menus, HUDs, settings, stats,
 * palette editor, tutorial, and credits.
 */

export const EN_US_STRINGS: Readonly<Record<string, string>> = {
  // Brand & App
  'app.title': 'KRUNKED LUMIA',
  'app.tagline': 'SYNESTHETIC DIAMOND PUZZLE',
  'app.studio': 'KRUNKED FOUNDRY',
  'app.version': 'v1.0',

  // Photosensitivity Warning
  'photosensitivity.title': 'PHOTOSENSITIVITY NOTICE',
  'photosensitivity.body':
    'Krunked Lumia features rhythmic flashing lights, bloom pulses, and geometric motion. Flashing and screen effects can be reduced or disabled anytime in Settings.',
  'photosensitivity.hint': 'PRESS ANY KEY, BUTTON, OR TAP TO CONTINUE',

  // Title & Main Navigation
  'menu.play': 'PLAY',
  'menu.settings': 'SETTINGS',
  'menu.colors': 'COLOR PALETTES',
  'menu.scores': 'SCORES & STATS',
  'menu.profiles': 'PROFILES',
  'menu.credits': 'CREDITS',
  'menu.back': 'BACK',
  'menu.confirm': 'CONFIRM',
  'menu.cancel': 'CANCEL',
  'menu.loadCustomPack': 'LOAD CUSTOM PACK',
  'menu.customPackActive': 'PACK: CUSTOM',
  'menu.builtinPackActive': 'PACK: BUILT-IN',
  'menu.switchToBuiltin': 'USE BUILT-IN ART',
  'menu.switchToCustom': 'USE CUSTOM PACK',

  // Mode Select
  'mode.selectTitle': 'SELECT MODE',
  'mode.marathon.name': 'MARATHON',
  'mode.marathon.desc': 'Clear 450 blocks',
  'mode.endless.name': 'ENDLESS',
  'mode.endless.desc': 'Play until the board fills up',
  'mode.intense.name': 'INTENSE',
  'mode.intense.desc': 'Clear 450 blocks at max level',
  'mode.relaxed.name': 'RELAXED',
  'mode.relaxed.desc': "Speed doesn't increase, no failure",
  'mode.rush.name': 'RUSH',
  'mode.rush.desc': 'Play for 2 minutes',
  'mode.impossible.name': 'IMPOSSIBLE',
  'mode.impossible.desc': 'Pain.',
  'mode.impossible.locked': 'Score 4,000,000 in any mode to unlock',
  'mode.locked': 'LOCKED',
  'mode.highScore': 'BEST',

  // Track Select
  'track.selectTitle': 'SELECT TRACK',
  'track.bpm': 'TEMPO',
  'track.artist': 'ARTIST',
  'track.poolStandard': 'STANDARD POOL',
  'track.poolRush': 'RUSH POOL',
  'track.startRun': 'START RUN',

  // Gameplay HUD
  'hud.score': 'SCORE',
  'hud.best': 'BEST',
  'hud.cleared': 'CLEARED',
  'hud.goal': 'GOAL',
  'hud.level': 'LEVEL',
  'hud.next': 'NEXT',
  'hud.time': 'TIME',
  'hud.combo': 'COMBO',
  'hud.perfectClear': 'PERFECT CLEAR!',
  'hud.levelUp': 'LEVEL UP',
  'hud.relaxedReset': 'BOARD CLEARED',
  'hud.soundtest': 'SOUNDTEST',

  // Pause & Endgame
  'pause.title': 'PAUSED',
  'pause.resume': 'RESUME',
  'pause.restart': 'RESTART',
  'pause.settings': 'SETTINGS',
  'pause.changeTrack': 'CHANGE TRACK',
  'pause.quit': 'MAIN MENU',

  'endgame.victory': 'CLEAR COMPLETE',
  'endgame.gameOver': 'GAME OVER',
  'endgame.rushComplete': 'TIME UP!',
  'endgame.newHighScore': 'NEW HIGH SCORE!',
  'endgame.newFastestTime': 'NEW FASTEST TIME!',
  'endgame.impossibleUnlocked': 'IMPOSSIBLE MODE UNLOCKED!',
  'endgame.finalScore': 'FINAL SCORE',
  'endgame.blocksCleared': 'BLOCKS CLEARED',
  'endgame.maxCombo': 'MAX COMBO',
  'endgame.elapsedTime': 'TIME',
  'endgame.playAgain': 'PLAY AGAIN',
  'endgame.changeTrack': 'CHANGE TRACK',
  'endgame.changeMode': 'CHANGE MODE',
  'endgame.mainMenu': 'MAIN MENU',

  // Settings Categories
  'settings.title': 'SETTINGS',
  'settings.tab.video': 'VIDEO',
  'settings.tab.gameplay': 'GAMEPLAY',
  'settings.tab.audio': 'AUDIO',
  'settings.tab.controls': 'CONTROLS',
  'settings.tab.pack': 'PACKS',
  'settings.on': 'ON',
  'settings.off': 'OFF',
  'settings.resetDefaults': 'RESET DEFAULTS',

  // Video Settings
  'settings.targetFps': 'TARGET FPS',
  'settings.targetFps.desc': 'Render frame pacing (30, 60, or 120 FPS). Simulation stays locked at 60 Hz.',
  'settings.native60Snap': 'NATIVE 60 SNAP',
  'settings.native60Snap.desc': 'Snap sprite motion strictly to 60 Hz ticks without sub-frame interpolation.',
  'settings.bloomAmount': 'BLOOM',
  'settings.bloomAmount.desc': 'Luminance-adaptive glow intensity on dark and light palettes.',
  'settings.boardShake': 'BOARD SHAKE',
  'settings.boardShake.desc': 'Subtle spring displacement on hard drops, lateral taps, and clears.',
  'settings.boardRipple': 'BOARD RIPPLE',
  'settings.boardRipple.desc': 'Cellular-automaton energy ripples across the diamond board.',
  'settings.particles': 'PARTICLES',
  'settings.particles.desc': 'Crisp pixel sparks emitted on locks, clears, and combos.',
  'settings.flashing': 'FLASHING',
  'settings.flashing.desc': 'Enable or disable board flash pulses on big clears and perfect clears.',
  'settings.bgShapes': 'BG SHAPES',
  'settings.bgShapes.desc': 'Expanding pixel-diamond geometry pulsing behind the board.',
  'settings.boardColors': 'BOARD COLORS',
  'settings.boardColors.desc': 'Tint the board interior with the active palette slot 1 color.',
  'settings.boardZoom': 'BOARD ZOOM',
  'settings.boardZoom.desc': 'Scale up the playfield closely for high-focus play.',
  'settings.tateRotate': 'TATE MODE (90°)',
  'settings.tateRotate.desc': 'Rotate the viewport 90 degrees for vertical monitor setups.',
  'settings.portraitMode': 'PORTRAIT MODE',
  'settings.portraitMode.desc': 'Auto-senses vertical phone screens for crisp 9:16 portrait gameplay.',
  'settings.touchControlsMode': 'TOUCH CONTROLS',
  'settings.touchControlsMode.desc': 'Translucent pixel virtual stick & buttons (AUTO reveals on touch).',
  'settings.touchOpacity': 'TOUCH OPACITY',
  'settings.touchOpacity.desc': 'Translucency of the on-screen pixel stick and spin/drop buttons.',

  // Gameplay Settings
  'settings.dropPreviewOpacity': 'DROP PREVIEW',
  'settings.dropPreviewOpacity.desc': 'Ghost piece visibility showing exact landing position.',
  'settings.nextBlockLocation': 'NEXT LOCATION',
  'settings.nextBlockLocation.desc': 'Corner position of the upcoming diamond preview.',
  'settings.nextBlockLocation.upper_left': 'UPPER LEFT',
  'settings.nextBlockLocation.upper_right': 'UPPER RIGHT',
  'settings.nextBlockLocation.lower_left': 'LOWER LEFT',
  'settings.nextBlockLocation.lower_right': 'LOWER RIGHT',
  'settings.preciseTimer': 'PRECISE TIMER',
  'settings.preciseTimer.desc': 'Show millisecond timing on speedrun modes and HUD.',
  'settings.moveSpeed': 'MOVE SPEED',
  'settings.moveSpeed.desc': 'Auto-repeat rate when holding left or right.',
  'settings.kbMoveDelay': 'KB MOVE DELAY',
  'settings.kbMoveDelay.desc': 'Initial hold delay in ticks before keyboard auto-repeat begins.',
  'settings.gpMoveDelay': 'GP MOVE DELAY',
  'settings.gpMoveDelay.desc': 'Initial hold delay in ticks before gamepad auto-repeat begins.',
  'settings.gamepadRumble': 'GAMEPAD RUMBLE',
  'settings.gamepadRumble.desc': 'Tactile controller vibration on hard drops and clears.',
  'settings.tutorialEnabled': 'TUTORIAL',
  'settings.tutorialEnabled.desc': 'Show interactive onboarding prompts during play.',
  'settings.soundtestEnabled': 'SOUNDTEST HUD',
  'settings.soundtestEnabled.desc': 'Display live loop, BPM, beat, and chord progression telemetry.',

  // Audio Settings
  'settings.masterVolume': 'MASTER VOLUME',
  'settings.masterVolume.desc': 'Overall volume for music loops, harmonic voices, and menu cues.',
  'settings.muted': 'MUTE AUDIO',
  'settings.muted.desc': 'Silence all audio output immediately.',

  // Control Action Labels
  'controls.keyboard': 'KEYBOARD',
  'controls.gamepad': 'GAMEPAD',
  'controls.pressKey': 'PRESS A KEY...',
  'controls.pressButton': 'PRESS A BUTTON...',
  'controls.resetBindings': 'RESET CONTROLS',
  'controls.action.up': 'MENU UP',
  'controls.action.down': 'MENU DOWN',
  'controls.action.left': 'MENU LEFT',
  'controls.action.right': 'MENU RIGHT',
  'controls.action.confirm': 'CONFIRM',
  'controls.action.cancel': 'CANCEL',
  'controls.action.moveLeft': 'MOVE LEFT',
  'controls.action.moveRight': 'MOVE RIGHT',
  'controls.action.hardDrop': 'HARD DROP',
  'controls.action.spinLeft': 'SPIN CCW',
  'controls.action.spinRight': 'SPIN CW',
  'controls.action.pause': 'PAUSE',

  // Palette Editor
  'palette.title': 'COLOR PALETTES',
  'palette.editorTitle': 'PALETTE EDITOR',
  'palette.slot.0': 'BACKGROUND',
  'palette.slot.1': 'BOARD',
  'palette.slot.2': 'BLOCK 1 / TEXT',
  'palette.slot.3': 'BLOCK 2 / ACCENT',
  'palette.slot.4': 'BLOCK 3 (HOLE)',
  'palette.slot.5': 'BLOCK 4 (TARGET)',
  'palette.edit': 'EDIT',
  'palette.new': 'NEW',
  'palette.copy': 'COPY',
  'palette.swap': 'SWAP',
  'palette.save': 'SAVE',
  'palette.delete': 'DELETE',
  'palette.share': 'SHARE',
  'palette.import': 'IMPORT',
  'palette.rename': 'RENAME',
  'palette.customTag': 'CUSTOM',
  'palette.builtinTag': 'BUILT-IN',
  'palette.darkMode': 'DARK BLOOM',
  'palette.lightMode': 'LIGHT INK BLOOM',
  'palette.copiedCode': 'SHARE CODE COPIED',
  'palette.importSuccess': 'PALETTE IMPORTED',
  'palette.importError': 'INVALID SHARE CODE',

  // Scores & Stats
  'stats.title': 'SCORES & STATS',
  'stats.highScores': 'HIGH SCORES',
  'stats.lifetime': 'LIFETIME STATS',
  'stats.gamesPlayed': 'GAMES PLAYED',
  'stats.marathonsCompleted': 'MARATHONS CLEARED',
  'stats.intenseMarathonsCompleted': 'INTENSE CLEARED',
  'stats.impossibleMarathonsCompleted': 'IMPOSSIBLE CLEARED',
  'stats.fastestMarathonMs': 'FASTEST MARATHON',
  'stats.fastestIntenseMarathonMs': 'FASTEST INTENSE',
  'stats.fastestImpossibleMarathonMs': 'FASTEST IMPOSSIBLE',
  'stats.longestEndlessMs': 'LONGEST ENDLESS',
  'stats.totalCombos': 'TOTAL COMBOS',
  'stats.longestCombo': 'LONGEST COMBO',
  'stats.biggestClear': 'BIGGEST CLEAR',
  'stats.highestClearScore': 'HIGHEST CLEAR SCORE',
  'stats.pointsScored': 'TOTAL POINTS',
  'stats.blocksCleared': 'BLOCKS CLEARED',
  'stats.perfectClears': 'PERFECT CLEARS',
  'stats.drops': 'HARD DROPS',
  'stats.timePlayedMs': 'TIME PLAYED',
  'stats.none': '--',

  // Profiles
  'profile.title': 'PLAYER PROFILES',
  'profile.active': 'ACTIVE',
  'profile.create': 'NEW PROFILE',
  'profile.rename': 'RENAME',
  'profile.delete': 'DELETE',
  'profile.select': 'SELECT',
  'profile.defaultName': 'Player 1',
  'profile.cannotDeleteLast': 'At least one profile is required.',

  // Tutorial Prompts
  'tutorial.move.title': 'SLIDE',
  'tutorial.move.hint': 'Move LEFT / RIGHT to glide along the 45° diamond walls.',
  'tutorial.spin.title': 'SPIN',
  'tutorial.spin.hint': 'Press SPIN CW or CCW to cycle the 4 diamond colors.',
  'tutorial.drop.title': 'DROP',
  'tutorial.drop.hint': 'Press HARD DROP to lock the tetrad and trigger slide-off gravity.',
  'tutorial.match.title': 'MATCH',
  'tutorial.match.hint': 'Line up 3+ diagonally or form a 2x2 diamond of matching color.',
  'tutorial.advanced.title': 'CHAIN',
  'tutorial.advanced.hint': 'Let blocks slide into valleys after a clear to build combos up to 4x!',
  'tutorial.done.title': 'READY!',
  'tutorial.done.hint': 'Tutorial complete — flow with the harmonic pulse.',

  // Credits (100% Original Krunked Foundry)
  'credits.title': 'CREDITS',
  'credits.lead': 'KRUNKED LUMIA — CREATED BY KRUNKED FOUNDRY',
  'credits.engineering': 'SIMULATION, WEBGL2 BLOOM & ARCHITECTURE — KRUNKED ENGINEERING',
  'credits.audio': 'BEAT-LOCKED HARMONIC SYNTH ENGINE & ORIGINAL TRACKS — KRUNKED SYNTH COLLECTIVE',
  'credits.visuals': '320x180 PIXEL-DIAMOND ART & 63 PALETTES — KRUNKED DESIGN LAB',
  'credits.thanks': 'BUILT FOR CRISP PIXELS, PURE GEOMETRY, AND HARMONIC FLOW.',
  'credits.footer': 'THANK YOU FOR PLAYING KRUNKED LUMIA',
};

/**
 * Look up a localized string by key with optional runtime overrides.
 * Returns the key itself if missing so UI never renders `undefined`.
 */
export function t(key: string, overrides?: Readonly<Record<string, string>>): string {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
    return overrides[key];
  }
  if (Object.prototype.hasOwnProperty.call(EN_US_STRINGS, key)) {
    return EN_US_STRINGS[key];
  }
  return key;
}

/**
 * Interpolate `{name}` placeholders inside a localized string.
 */
export function formatT(
  key: string,
  params: Readonly<Record<string, string | number>>,
  overrides?: Readonly<Record<string, string>>,
): string {
  const template = t(key, overrides);
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      return String(params[name]);
    }
    return match;
  });
}

/**
 * Parse a 2-column (or multi-column, key=col0, text=col1) RFC-4180 CSV
 * localization table into a key -> string dictionary.
 * Handles UTF-8 BOM, CRLF/LF, quoted fields, escaped double-quotes (`""`),
 * embedded commas/newlines, and skips standard header rows.
 */
export function parseLocalizationCsv(csv: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!csv) {
    return result;
  }

  const input = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  for (let r = 0; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length < 2) {
      continue;
    }
    const key = cols[0].trim();
    if (!key) {
      continue;
    }
    if (
      r === 0 &&
      (key.toLowerCase() === 'key' || key.toLowerCase() === 'id' || key.toLowerCase() === 'string_id')
    ) {
      continue;
    }
    result[key] = cols[1];
  }

  return result;
}
