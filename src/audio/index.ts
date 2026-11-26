/**
 * Krunked Lumia — Audio Subsystem Public Barrel Exports
 */

export {
  SYNTH_PACKS,
  RUSH_BPM_SEQUENCE,
  RUSH_LOOP_CHAIN,
  getSoundpackManifest,
  midiToFreq,
  computeLoopDurationSec,
  computeProgressionSliceIndex,
  resolveChordForGroup,
  resolveLoopPattern,
  type ChordVoicing,
  type TrackTimbreSpec,
  type LoopPatternSpec,
  type SynthPackSpec,
  type SynthWaveType,
} from './synthPacks.js';

export {
  DEFAULT_MENU_AUDIO_FILES,
  stripTrailingCommas,
  parseLenientJson,
  parseTrackDataJson,
  collectManifestAudioRefs,
  indexDecodedBuffer,
  resolveAudioBuffer,
  loadCustomTrackFromUrl,
  loadCustomTrackFromBuffers,
  loadCustomMenuAudioFromUrl,
  loadCustomMenuAudioFromBuffers,
  loadCustomAudioPackFromUrl,
  loadCustomAudioPackFromBuffers,
  type CustomTrackAudioPack,
  type CustomAudioPack,
} from './customAudioLoader.js';

export {
  MENU_SFX_IDS,
  MENU_LOOP_GAIN,
  MenuAudioController,
  type MenuSfxId,
  type AudioBusProvider,
} from './menuAudio.js';

export { HarmonicAudioEngine } from './HarmonicAudioEngine.js';
