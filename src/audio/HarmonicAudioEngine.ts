/**
 * Krunked Lumia — Beat-Locked Harmonic Progression Audio Engine
 *
 * The synesthetic musical heart of Krunked Lumia:
 * - Tracks beat-accurate loop phase (`loopElapsed`, `currentLoopName`, `queuedSection`,
 *   `progressionStep`) across all 8 tracks, including `rush`'s 13-stage multi-tempo BPM arc.
 * - Maps live gameplay `SimEvent[]` (`TETRAD_MOVE`, `TETRAD_SPIN`, `TETRAD_HARD_DROP`,
 *   `TETRAD_LOCK`, `BLOCKS_CLEAR`, `COMBO_CHAIN`, `PERFECT_CLEAR`, `SONG_SECTION`, etc.)
 *   onto the active harmonic progression slice `[dropGroup, moveGroup, clearGroup, comboGroup]`.
 * - Runs a sample-accurate Web Audio lookahead scheduler driving either 100% original
 *   procedural step-sequencer synthesis (Built-In mode) OR seamless decoded `.ogg`
 *   `AudioBufferSourceNode` loops (Custom Pack mode with silent per-cue procedural fallback).
 * - Completely safe in headless / Node environments without `AudioContext`.
 */

import type {
  PackMode,
  ProgressionSlice,
  SimEvent,
  SongSection,
  SoundpackLoopDef,
  SoundpackManifest,
  SoundtestTelemetry,
  TrackId,
} from '../contracts/index.js';
import { type CustomAudioPack, resolveAudioBuffer } from './customAudioLoader.js';
import { MenuAudioController, type MenuSfxId } from './menuAudio.js';
import {
  type ChordVoicing,
  type LoopPatternSpec,
  SYNTH_PACKS,
  type SynthPackSpec,
  computeLoopDurationSec,
  computeProgressionSliceIndex,
  midiToFreq,
  resolveChordForGroup,
  resolveLoopPattern,
} from './synthPacks.js';

const LOOKAHEAD_SEC = 0.12;
const SCHEDULER_INTERVAL_MS = 25;
const BOUNDARY_COMMIT_WINDOW_SEC = 0.035;

const SECTION_SET: ReadonlySet<string> = new Set<SongSection>(['start', 'middle', 'outro', 'end']);

function isSongSection(name: string): name is SongSection {
  return SECTION_SET.has(name);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export class HarmonicAudioEngine {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private loopGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private masterVolume = 0.85;
  private muted = false;

  private packMode: PackMode = 'builtin';
  private customPack: CustomAudioPack | null = null;

  private activeTrackId: TrackId = 'tessellation';
  private playing = false;
  private currentLoopName = 'start';
  private currentSection: SongSection = 'start';
  private queuedSection: SongSection | null = null;
  private loopElapsed = 0;
  private progressionStep = 0;
  private moveStepIndex = 0;

  // Web Audio sample-accurate clock state
  private loopStartCtxTime = 0;
  private lastScheduledStep = -1;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private activeCustomLoopSource: AudioBufferSourceNode | null = null;
  private pendingCustomLoopSource: AudioBufferSourceNode | null = null;
  private pendingNextLoopName: string | null = null;
  private pendingNextCommitted = false;

  public readonly menu: MenuAudioController;

  constructor(initialVolume = 0.85, initialMuted = false) {
    this.masterVolume = clamp01(initialVolume);
    this.muted = initialMuted;
    this.menu = new MenuAudioController({
      getContext: () => this.ensureContext(),
      getDestination: () => this.masterGain,
    });
  }

  /** Lazily create `AudioContext` and master DSP graph. Returns `null` in Node/headless. */
  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      return this.ctx;
    }
    const g = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioCtxCtor = g.AudioContext ?? g.webkitAudioContext;
    if (typeof AudioCtxCtor !== 'function') {
      return null;
    }

    try {
      const ctx = new AudioCtxCtor();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-10, ctx.currentTime);
      compressor.knee.setValueAtTime(14, ctx.currentTime);
      compressor.ratio.setValueAtTime(4, ctx.currentTime);
      compressor.attack.setValueAtTime(0.004, ctx.currentTime);
      compressor.release.setValueAtTime(0.14, ctx.currentTime);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this.muted ? 0 : this.masterVolume, ctx.currentTime);

      const loopGain = ctx.createGain();
      loopGain.gain.setValueAtTime(0.68, ctx.currentTime);

      const sfxGain = ctx.createGain();
      sfxGain.gain.setValueAtTime(0.9, ctx.currentTime);

      loopGain.connect(masterGain);
      sfxGain.connect(masterGain);
      masterGain.connect(compressor);
      compressor.connect(ctx.destination);

      this.ctx = ctx;
      this.compressor = compressor;
      this.masterGain = masterGain;
      this.loopGain = loopGain;
      this.sfxGain = sfxGain;
      this.noiseBuffer = this.createNoiseBuffer(ctx);
      return ctx;
    } catch {
      return null;
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 1.0));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic PRNG white noise so synthesis never depends on Math.random edge quirks
    let seed = 0x5a17f9c3;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    return buffer;
  }

  /** Expose the lazily created `AudioContext` (or `null` when headless/uninitialized). */
  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  /** Resume or initialize Web Audio on a user gesture. Completely safe in headless Node. */
  public async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Ignore browser autoplay policy error if called outside gesture
      }
    }
    if (this.playing && this.schedulerTimer === null) {
      this.loopStartCtxTime = ctx.currentTime - this.loopElapsed;
      this.startSchedulerLoop();
    }
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = clamp01(volume);
    this.applyMasterGain();
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setMuted(muted: boolean): void {
    this.muted = Boolean(muted);
    this.applyMasterGain();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private applyMasterGain(): void {
    if (!this.ctx || !this.masterGain) return;
    const target = this.muted ? 0 : this.masterVolume;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.015);
  }

  /** Switch between Built-In procedural packs and an optional loaded Custom Audio Pack. */
  public setPackMode(mode: PackMode, customPack?: CustomAudioPack | null): void {
    this.packMode = mode;
    if (customPack !== undefined) {
      this.customPack = customPack;
    }
    const menuBuffers =
      this.packMode === 'custom' && this.customPack ? this.customPack.menuBuffers : null;
    this.menu.setCustomBuffers(menuBuffers);

    // If a track is currently playing, re-align buses & loop source cleanly
    if (this.playing) {
      const manifest = this.getActiveManifest();
      if (!manifest.loops[this.currentLoopName]) {
        this.currentLoopName = manifest.loops.start
          ? 'start'
          : (Object.keys(manifest.loops)[0] ?? 'start');
        this.loopElapsed = 0;
      }
      this.applyManifestBusGains(manifest);
      this.stopCustomLoopSources();
      this.lastScheduledStep = -1;
      if (this.ctx && this.ctx.state === 'running') {
        this.loopStartCtxTime = this.ctx.currentTime - this.loopElapsed;
        this.syncToAudioClock();
      }
    }
  }

  public getPackMode(): PackMode {
    return this.packMode;
  }

  /** Retrieve the active SoundpackManifest (custom override if loaded in custom mode, else built-in). */
  public getActiveManifest(trackId: TrackId = this.activeTrackId): SoundpackManifest {
    if (this.packMode === 'custom' && this.customPack?.tracks[trackId]) {
      return this.customPack.tracks[trackId]!.manifest;
    }
    return SYNTH_PACKS[trackId].manifest;
  }

  public startMenuMusic(): void {
    if (this.playing) {
      this.stop();
    }
    this.ensureContext();
    this.menu.startMenuLoop();
  }

  public stopMenuMusic(): void {
    this.menu.stopMenuLoop();
  }

  public playMenuSfx(id: MenuSfxId): void {
    this.menu.play(id);
  }

  /** Start playing one of the 8 beat-locked harmonic tracks from its `start` loop. */
  public startTrack(trackId: TrackId): void {
    this.menu.stopMenuLoop();
    this.stopTrackInternal();

    this.activeTrackId = trackId;
    const manifest = this.getActiveManifest(trackId);
    this.currentLoopName = manifest.loops.start
      ? 'start'
      : (Object.keys(manifest.loops)[0] ?? 'start');
    this.currentSection = isSongSection(this.currentLoopName) ? this.currentLoopName : 'start';
    this.queuedSection = null;
    this.loopElapsed = 0;
    this.progressionStep = 0;
    this.moveStepIndex = 0;
    this.lastScheduledStep = -1;
    this.pendingNextLoopName = null;
    this.pendingNextCommitted = false;
    this.playing = true;

    const ctx = this.ensureContext();
    this.applyManifestBusGains(manifest);

    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      this.loopStartCtxTime = ctx.currentTime + 0.02;
      this.syncToAudioClock();
      this.startSchedulerLoop();
    }
  }

  /**
   * Queue a section transition (`start -> middle -> outro -> end`) to execute cleanly
   * at the next exact loop boundary.
   */
  public advanceSection(section: SongSection): void {
    if (section === this.currentLoopName) {
      this.queuedSection = null;
      return;
    }
    const manifest = this.getActiveManifest();
    if (manifest.loops[section]) {
      this.queuedSection = section;
    } else {
      // Still record desired section even if a custom manifest uses non-standard loop keys
      this.queuedSection = section;
    }
  }

  /** Stop active gameplay track music cleanly. */
  public stop(): void {
    this.stopTrackInternal();
  }

  private stopTrackInternal(): void {
    this.playing = false;
    this.queuedSection = null;
    this.pendingNextLoopName = null;
    this.pendingNextCommitted = false;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.stopCustomLoopSources();
  }

  private stopCustomLoopSources(): void {
    for (const src of [this.activeCustomLoopSource, this.pendingCustomLoopSource]) {
      if (!src) continue;
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped source
      }
    }
    this.activeCustomLoopSource = null;
    this.pendingCustomLoopSource = null;
  }

  private startSchedulerLoop(): void {
    if (this.schedulerTimer !== null) return;
    this.schedulerTimer = setInterval(() => {
      this.syncToAudioClock();
    }, SCHEDULER_INTERVAL_MS);
  }

  private applyManifestBusGains(manifest: SoundpackManifest): void {
    if (!this.ctx || !this.loopGain || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const masterScale = clamp01(manifest.gain.master);
    this.loopGain.gain.setTargetAtTime(clamp01(manifest.gain.loop) * masterScale, now, 0.02);
    this.sfxGain.gain.setTargetAtTime(masterScale, now, 0.02);
  }

  /**
   * Advance audio clock and scheduler.
   * - In browser with running Web Audio: syncs sample-accurately to `ctx.currentTime`.
   * - In headless / Node / paused AudioContext: deterministically advances `loopElapsed += dtSec`
   *   and executes exact loop boundary transitions & progression slice updates.
   */
  public update(dtSec: number): void {
    this.menu.update(dtSec);
    if (!this.playing || dtSec <= 0 || !Number.isFinite(dtSec)) return;

    if (this.ctx && this.ctx.state === 'running') {
      this.syncToAudioClock();
      return;
    }

    // Deterministic headless / suspended clock advancement
    this.loopElapsed += dtSec;
    let safety = 0;
    while (safety < 64) {
      safety += 1;
      const { loopLenSec } = this.getActiveLoopTiming();
      if (loopLenSec <= 0) break;
      if (this.loopElapsed < loopLenSec) break;
      this.loopElapsed -= loopLenSec;
      this.commitLoopTransition();
    }

    const { bpm, lengthBeats, progression } = this.getActiveLoopTiming();
    this.progressionStep = computeProgressionSliceIndex(
      this.loopElapsed,
      bpm,
      lengthBeats,
      progression.length,
    );
  }

  /** Consume simulation events from `stepSim()` and fire beat-locked harmonic audio cues. */
  public processSimEvents(events: readonly SimEvent[]): void {
    let hardDroppedInBatch = false;

    for (const ev of events) {
      switch (ev.type) {
        case 'TETRAD_MOVE': {
          if (!ev.blocked) {
            const vel = 0.65 + (this.moveStepIndex % 4) * 0.08;
            this.triggerMove(Math.min(1.0, vel));
          }
          break;
        }
        case 'TETRAD_SPIN': {
          const vel = ev.slackReset ? 0.92 : 0.8;
          this.triggerMove(vel);
          break;
        }
        case 'TETRAD_HARD_DROP': {
          hardDroppedInBatch = true;
          this.triggerDrop(1.0);
          break;
        }
        case 'TETRAD_LOCK': {
          if (!hardDroppedInBatch) {
            this.triggerDrop(0.75);
          }
          break;
        }
        case 'BLOCKS_CLEAR': {
          const vel = 0.8 + ev.clearTier * 0.1;
          this.triggerClear(ev.clearTier, vel);
          break;
        }
        case 'COMBO_CHAIN': {
          const vel = 0.9 + ev.comboTier * 0.05;
          this.triggerCombo(ev.comboTier, ev.combo, vel);
          break;
        }
        case 'PERFECT_CLEAR': {
          this.triggerPerfectClear();
          break;
        }
        case 'SONG_SECTION': {
          this.advanceSection(ev.section);
          break;
        }
        case 'TUTORIAL_ADVANCE': {
          if (ev.completed) {
            this.menu.playTutorialOff();
          } else {
            this.menu.playTutorialTrigger();
          }
          break;
        }
        case 'RELAXED_RESET': {
          this.menu.playTutorialOff();
          break;
        }
        case 'GAME_OVER': {
          this.advanceSection('end');
          this.menu.playFail();
          break;
        }
        case 'GAME_VICTORY': {
          this.advanceSection('end');
          this.triggerPerfectClear();
          break;
        }
        case 'TETRAD_SPAWN':
        case 'BLOCK_SLIDE':
        case 'LEVEL_UP':
          break;
      }
    }
  }

  /** Expose full real-time beat-locked Soundtest telemetry. */
  public getSoundtestTelemetry(): SoundtestTelemetry {
    const timing = this.getActiveLoopTiming();
    const sliceIdx = computeProgressionSliceIndex(
      this.loopElapsed,
      timing.bpm,
      timing.lengthBeats,
      timing.progression.length,
    );
    this.progressionStep = sliceIdx;
    const activeGroups = timing.progression[sliceIdx] ?? timing.progression[0] ?? ['', '', '', ''];
    let wrappedElapsed = timing.loopLenSec > 0 ? this.loopElapsed % timing.loopLenSec : 0;
    if (wrappedElapsed < 0) wrappedElapsed += timing.loopLenSec;
    const loopProgress = timing.loopLenSec > 0 ? wrappedElapsed / timing.loopLenSec : 0;
    const totalBeats = Math.max(1, Math.round(timing.lengthBeats));
    const beatIndex = Math.floor(loopProgress * totalBeats) % totalBeats;

    return {
      trackId: this.activeTrackId,
      packMode: this.packMode,
      loopName: this.currentLoopName,
      nextLoopName: this.peekNextLoopName(),
      section: this.currentSection,
      bpm: timing.bpm,
      loopProgress,
      beatIndex,
      progressionName: timing.progressionName,
      progressionStep: sliceIdx,
      progressionLength: timing.progression.length,
      activeGroups,
    };
  }

  public getQueuedSection(): SongSection | null {
    return this.queuedSection;
  }

  public getLoopElapsed(): number {
    return this.loopElapsed;
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  // ==========================================================================
  // GAMEPLAY HARMONIC TRIGGERS
  // ==========================================================================

  /** Play the active `moveGroup` chord tone (cycles melodically across moves & spins). */
  public triggerMove(velocity = 0.78): void {
    const step = this.moveStepIndex;
    this.moveStepIndex += 1;

    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    const manifest = this.getActiveManifest();
    const activeGroups = this.getCurrentActiveGroups();
    const moveGroup = activeGroups[1];
    const vel = clamp01(velocity) * clamp01(manifest.gain.move);

    if (this.tryPlayCustomGroupSample(ctx, manifest.move_groups[moveGroup], step, vel)) {
      return;
    }

    const pack = SYNTH_PACKS[this.activeTrackId];
    const chord = this.resolveActiveProceduralChord(pack, moveGroup);
    const midi = chord.moveMidis[step % chord.moveMidis.length];
    this.synthMoveVoice(ctx, this.sfxGain, pack, midi, vel);
  }

  /** Play the active `dropGroup` punchy tonal percussive thump. */
  public triggerDrop(velocity = 0.95): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    const manifest = this.getActiveManifest();
    const activeGroups = this.getCurrentActiveGroups();
    const dropGroup = activeGroups[0];
    const vel = clamp01(velocity) * clamp01(manifest.gain.drop);

    const dropRef = manifest.drop_groups[dropGroup];
    const list = Array.isArray(dropRef) ? dropRef : dropRef ? [dropRef] : [];
    if (this.tryPlayCustomGroupSample(ctx, list, 0, vel)) {
      return;
    }

    const pack = SYNTH_PACKS[this.activeTrackId];
    const chord = this.resolveActiveProceduralChord(pack, dropGroup);
    this.synthDropVoice(ctx, this.sfxGain, pack, chord.bassMidi, vel);
  }

  /** Play the active `clearGroup` lush harmonic chord swell/arpeggio indexed by `clearTier`. */
  public triggerClear(clearTier: 0 | 1 | 2 = 0, velocity = 0.9): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    const manifest = this.getActiveManifest();
    const activeGroups = this.getCurrentActiveGroups();
    const clearGroup = activeGroups[2];
    const vel = clamp01(velocity) * clamp01(manifest.gain.clear);

    const list = manifest.clear_groups[clearGroup];
    if (list && list.length > 0) {
      const idx = Math.min(clearTier, list.length - 1);
      if (this.tryPlayCustomGroupSample(ctx, list, idx, vel)) {
        return;
      }
    }

    const pack = SYNTH_PACKS[this.activeTrackId];
    const chord = this.resolveActiveProceduralChord(pack, clearGroup);
    const midis = chord.clearTiers[clearTier] ?? chord.clearTiers[0];
    this.synthClearChordVoice(ctx, this.sfxGain, pack, midis, clearTier, vel);
  }

  /** Play the active `comboGroup` sparkling ascending harmonic chime/riser. */
  public triggerCombo(comboTier: 0 | 1 | 2 = 0, comboCount = 2, velocity = 0.95): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    const manifest = this.getActiveManifest();
    const activeGroups = this.getCurrentActiveGroups();
    const comboGroup = activeGroups[3];
    const vel = clamp01(velocity) * clamp01(manifest.gain.combo);

    const list = manifest.combo_groups[comboGroup];
    if (list && list.length > 0) {
      const idx = Math.min(comboTier, list.length - 1);
      if (this.tryPlayCustomGroupSample(ctx, list, idx, vel)) {
        return;
      }
    }

    const pack = SYNTH_PACKS[this.activeTrackId];
    const chord = this.resolveActiveProceduralChord(pack, comboGroup);
    const midis = chord.comboTiers[comboTier] ?? chord.comboTiers[0];
    this.synthComboChimeVoice(ctx, this.sfxGain, pack, midis, comboCount, vel);
  }

  /** Play a triumphant harmonic fanfare chord locked to the track's key & active chord. */
  public triggerPerfectClear(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    const pack = SYNTH_PACKS[this.activeTrackId];
    const root = pack.rootMidi;
    const fanfare = [root, root + 4, root + 7, root + 11, root + 14, root + 19, root + 24];
    const now = ctx.currentTime;

    // Warm sustaining base chord bloom
    this.synthPadStep(
      ctx,
      this.sfxGain,
      pack,
      [root - 12, root, root + 7, root + 11, root + 14],
      now,
      1.35,
      0.85,
      1.0,
    );

    // Sparkling ascending Lydian/Maj9 fanfare cascade
    fanfare.forEach((midi, idx) => {
      const t = now + idx * 0.048;
      const osc = ctx.createOscillator();
      const harmonic = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      harmonic.type = 'sine';
      const freq = midiToFreq(midi);
      osc.frequency.setValueAtTime(freq, t);
      harmonic.frequency.setValueAtTime(freq * 2, t);

      const peak = 0.16 + idx * 0.012;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);

      osc.connect(gain);
      harmonic.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(t);
      harmonic.start(t);
      osc.stop(t + 0.75);
      harmonic.stop(t + 0.75);
    });
  }

  public dispose(): void {
    this.stopTrackInternal();
    this.menu.dispose();
    if (this.compressor) {
      try {
        this.compressor.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        // Ignore close errors
      }
    }
    this.ctx = null;
    this.compressor = null;
    this.masterGain = null;
    this.loopGain = null;
    this.sfxGain = null;
    this.noiseBuffer = null;
  }

  // ==========================================================================
  // INTERNAL LOOP TIMING & LOOKAHEAD SCHEDULER
  // ==========================================================================

  private getActiveLoopTiming(): {
    manifest: SoundpackManifest;
    loopDef: SoundpackLoopDef;
    bpm: number;
    lengthBeats: number;
    loopLenSec: number;
    progressionName: string;
    progression: ProgressionSlice[];
  } {
    const manifest = this.getActiveManifest();
    const loopDef: SoundpackLoopDef =
      manifest.loops[this.currentLoopName] ??
      manifest.loops.start ??
      Object.values(manifest.loops)[0] ?? {
        audio: '',
        bpm: manifest.baseBpm,
        length: 16,
      };
    const bpm = loopDef.bpm && loopDef.bpm > 0 ? loopDef.bpm : manifest.baseBpm;
    const lengthBeats = loopDef.length && loopDef.length > 0 ? loopDef.length : 16;
    const loopLenSec = computeLoopDurationSec(bpm, lengthBeats);

    const fallbackProgKey = Object.keys(manifest.progressions)[0] ?? 'default';
    const progressionName =
      loopDef.progression && manifest.progressions[loopDef.progression]
        ? loopDef.progression
        : fallbackProgKey;
    const progression = manifest.progressions[progressionName] ?? [['0', '0', '0', '0']];

    return {
      manifest,
      loopDef,
      bpm,
      lengthBeats,
      loopLenSec,
      progressionName,
      progression,
    };
  }

  private getCurrentActiveGroups(): ProgressionSlice {
    const { bpm, lengthBeats, progression } = this.getActiveLoopTiming();
    const idx = computeProgressionSliceIndex(this.loopElapsed, bpm, lengthBeats, progression.length);
    this.progressionStep = idx;
    return progression[idx] ?? progression[0] ?? ['', '', '', ''];
  }

  private peekNextLoopName(): string {
    const manifest = this.getActiveManifest();
    if (this.queuedSection && manifest.loops[this.queuedSection]) {
      return this.queuedSection;
    }
    const loopDef = manifest.loops[this.currentLoopName];
    if (loopDef?.next && manifest.loops[loopDef.next]) {
      return loopDef.next;
    }
    return this.currentLoopName;
  }

  private commitLoopTransition(): void {
    const manifest = this.getActiveManifest();
    const nextLoop = this.pendingNextCommitted && this.pendingNextLoopName
      ? this.pendingNextLoopName
      : this.peekNextLoopName();

    if (this.queuedSection && nextLoop === this.queuedSection) {
      this.currentSection = this.queuedSection;
      this.queuedSection = null;
    } else if (isSongSection(nextLoop)) {
      this.currentSection = nextLoop;
      if (this.queuedSection === nextLoop) {
        this.queuedSection = null;
      }
    } else if (this.queuedSection && !manifest.loops[this.queuedSection]) {
      // Custom manifest lacks explicit loop key; still update logical section state
      this.currentSection = this.queuedSection;
      this.queuedSection = null;
    }

    this.currentLoopName = nextLoop;
    this.lastScheduledStep = -1;
    this.pendingNextLoopName = null;
    this.pendingNextCommitted = false;

    if (this.pendingCustomLoopSource) {
      this.activeCustomLoopSource = this.pendingCustomLoopSource;
      this.pendingCustomLoopSource = null;
    }
  }

  private syncToAudioClock(): void {
    if (!this.playing || !this.ctx || !this.loopGain || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1. Advance across any completed loop boundaries
    let safety = 0;
    while (safety < 16) {
      safety += 1;
      const { loopLenSec } = this.getActiveLoopTiming();
      if (loopLenSec <= 0) break;
      if (now < this.loopStartCtxTime + loopLenSec) break;
      this.loopStartCtxTime += loopLenSec;
      this.commitLoopTransition();
    }

    // 2. Compute current audible loopElapsed & progression slice
    const timing = this.getActiveLoopTiming();
    this.loopElapsed = Math.max(0, now - this.loopStartCtxTime);
    this.progressionStep = computeProgressionSliceIndex(
      this.loopElapsed,
      timing.bpm,
      timing.lengthBeats,
      timing.progression.length,
    );

    const loopEndTime = this.loopStartCtxTime + timing.loopLenSec;
    const horizon = now + LOOKAHEAD_SEC;

    // 3. Custom Pack Mode: use decoded AudioBuffer loop if available, else procedural fallback
    const customLoopBuf = this.getCustomLoopBuffer(timing.loopDef.audio);
    if (customLoopBuf) {
      if (!this.activeCustomLoopSource) {
        this.activeCustomLoopSource = this.startCustomLoopBuffer(
          ctx,
          customLoopBuf,
          this.loopStartCtxTime,
          loopEndTime,
        );
      }

      if (
        !this.pendingNextCommitted &&
        loopEndTime - now <= Math.max(LOOKAHEAD_SEC, BOUNDARY_COMMIT_WINDOW_SEC)
      ) {
        const nextName = this.peekNextLoopName();
        this.pendingNextLoopName = nextName;
        this.pendingNextCommitted = true;
        const nextLoopDef = timing.manifest.loops[nextName];
        const nextBuf = nextLoopDef ? this.getCustomLoopBuffer(nextLoopDef.audio) : null;
        if (nextBuf && nextLoopDef) {
          const nextBpm = nextLoopDef.bpm && nextLoopDef.bpm > 0 ? nextLoopDef.bpm : timing.manifest.baseBpm;
          const nextBeats = nextLoopDef.length && nextLoopDef.length > 0 ? nextLoopDef.length : 16;
          const nextEnd = loopEndTime + computeLoopDurationSec(nextBpm, nextBeats);
          this.pendingCustomLoopSource = this.startCustomLoopBuffer(ctx, nextBuf, loopEndTime, nextEnd);
        }
      }
      return;
    }

    // 4. Built-In Procedural Step Sequencer (16th-note grid locked to current loop BPM & progression)
    const pack = SYNTH_PACKS[this.activeTrackId];
    const pattern = resolveLoopPattern(pack, this.currentLoopName, this.currentSection);
    const totalSteps = Math.max(1, Math.round(timing.lengthBeats * 4));
    const stepDur = (60 / timing.bpm) / 4;

    while (this.lastScheduledStep + 1 < totalSteps) {
      const stepIdx = this.lastScheduledStep + 1;
      const swingOffset = stepIdx % 2 === 1 ? stepDur * pattern.swing : 0;
      const stepTime = this.loopStartCtxTime + stepIdx * stepDur + swingOffset;
      if (stepTime > horizon) break;
      this.lastScheduledStep = stepIdx;

      if (stepTime < now - 0.08) continue;

      const sliceIdx =
        Math.floor((stepIdx / totalSteps) * timing.progression.length) % timing.progression.length;
      const slice = timing.progression[sliceIdx] ?? timing.progression[0];
      const chord = this.resolveActiveProceduralChord(pack, slice[1]);
      this.scheduleSequencerStep(ctx, this.loopGain, pack, pattern, chord, stepIdx, stepTime, stepDur);
    }
  }

  private getCustomLoopBuffer(audioRef: string): AudioBuffer | null {
    if (this.packMode !== 'custom' || !this.customPack) return null;
    const customTrack = this.customPack.tracks[this.activeTrackId];
    if (!customTrack) return null;
    return resolveAudioBuffer(customTrack.buffers, audioRef);
  }

  private startCustomLoopBuffer(
    ctx: AudioContext,
    buffer: AudioBuffer,
    loopStart: number,
    loopEnd: number,
  ): AudioBufferSourceNode | null {
    if (!this.loopGain) return null;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(this.loopGain);
      const now = ctx.currentTime;
      if (loopStart >= now) {
        src.start(loopStart, 0);
      } else {
        const offset = (now - loopStart) % Math.max(0.01, buffer.duration);
        src.start(now, offset);
      }
      if (loopEnd > now + 0.005) {
        src.stop(loopEnd + 0.008);
      }
      return src;
    } catch {
      return null;
    }
  }

  private tryPlayCustomGroupSample(
    ctx: AudioContext,
    groupList: readonly string[] | undefined,
    index: number,
    gainLevel: number,
  ): boolean {
    if (this.packMode !== 'custom' || !this.customPack || !this.sfxGain) return false;
    const customTrack = this.customPack.tracks[this.activeTrackId];
    if (!customTrack || !groupList || groupList.length === 0) return false;

    const cueRef = groupList[((index % groupList.length) + groupList.length) % groupList.length];
    const buffer = resolveAudioBuffer(customTrack.buffers, cueRef);
    if (!buffer) return false;

    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(Math.max(0.001, gainLevel), ctx.currentTime);
      src.connect(gain);
      gain.connect(this.sfxGain);
      src.start(ctx.currentTime);
      return true;
    } catch {
      return false;
    }
  }

  private resolveActiveProceduralChord(pack: SynthPackSpec, groupName: string): ChordVoicing {
    if (pack.groupToChord[groupName]) {
      return resolveChordForGroup(pack, groupName);
    }
    // When running in Custom mode with missing `.ogg` fallback, map by current progressionStep
    const builtinManifest = pack.manifest;
    const progKey =
      builtinManifest.loops[this.currentLoopName]?.progression ??
      builtinManifest.loops[this.currentSection]?.progression ??
      Object.keys(builtinManifest.progressions)[0];
    const prog = builtinManifest.progressions[progKey];
    if (prog && prog.length > 0) {
      const slice = prog[this.progressionStep % prog.length];
      return resolveChordForGroup(pack, slice[1]);
    }
    return resolveChordForGroup(pack, groupName);
  }

  // ==========================================================================
  // PROCEDURAL WEB AUDIO SYNTHESIS VOICES
  // ==========================================================================

  private scheduleSequencerStep(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    pattern: LoopPatternSpec,
    chord: ChordVoicing,
    stepIdx: number,
    time: number,
    stepDur: number,
  ): void {
    const barStep = stepIdx % 16;
    const energy = pattern.energy;

    const padVel = pattern.pad[barStep] ?? 0;
    if (padVel > 0) {
      this.synthPadStep(ctx, dest, pack, chord.padMidis, time, stepDur * 7.5, padVel, energy);
    }

    const bassVel = pattern.bass[barStep] ?? 0;
    if (bassVel > 0) {
      const offset = pattern.bassOffsets[barStep] ?? 0;
      this.synthBassStep(ctx, dest, pack, chord.bassMidi + offset, time, stepDur * 1.6, bassVel, energy);
    }

    const arpVel = pattern.arp[barStep] ?? 0;
    if (arpVel > 0 && chord.arpMidis.length > 0) {
      const arpNote = chord.arpMidis[(stepIdx + Math.floor(stepIdx / 8)) % chord.arpMidis.length];
      const octaveLift = energy > 0.9 && barStep % 4 === 3 ? 12 : 0;
      this.synthArpStep(ctx, dest, pack, arpNote + octaveLift, time, stepDur * 1.4, arpVel, energy);
    }

    const kickVel = pattern.kick[barStep] ?? 0;
    if (kickVel > 0) {
      this.synthKick(ctx, dest, pack, time, kickVel);
    }

    const snareVel = pattern.snare[barStep] ?? 0;
    if (snareVel > 0) {
      this.synthSnare(ctx, dest, pack, time, snareVel);
    }

    const hatVel = pattern.hat[barStep] ?? 0;
    if (hatVel > 0) {
      this.synthHat(ctx, dest, pack, time, hatVel);
    }

    const percVel = pattern.perc[barStep] ?? 0;
    if (percVel > 0) {
      this.synthPerc(ctx, dest, pack, time, percVel, barStep);
    }
  }

  private synthPadStep(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    midis: readonly number[],
    time: number,
    dur: number,
    velocity: number,
    energy: number,
  ): void {
    const p = pack.timbre.pad;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(p.cutoffHz * (0.7 + energy * 0.5), time);
    filter.Q.setValueAtTime(0.9, time);

    const env = ctx.createGain();
    const peak = p.gain * velocity / Math.max(1, Math.sqrt(midis.length));
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + Math.min(p.attack, dur * 0.3));
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur + p.release);

    filter.connect(env);
    env.connect(dest);

    for (let i = 0; i < midis.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = p.wave;
      osc.frequency.setValueAtTime(midiToFreq(midis[i]), time);
      osc.detune.setValueAtTime((i % 2 === 0 ? -1 : 1) * p.detuneCents, time);
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + dur + p.release + 0.04);
    }
  }

  private synthBassStep(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    midi: number,
    time: number,
    dur: number,
    velocity: number,
    energy: number,
  ): void {
    const b = pack.timbre.bass;
    const freq = midiToFreq(midi);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const startCut = b.cutoffHz * (0.85 + energy * 0.65);
    filter.frequency.setValueAtTime(startCut * 1.4, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, startCut * 0.55), time + b.decay);
    filter.Q.setValueAtTime(b.q, time);

    const env = ctx.createGain();
    const peak = b.gain * velocity;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + b.attack);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * b.sustain), time + b.attack + b.decay);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur + b.release);

    const osc = ctx.createOscillator();
    osc.type = b.wave;
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(filter);

    if (b.subMix > 0.05) {
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(freq, time);
      subGain.gain.setValueAtTime(b.subMix, time);
      sub.connect(subGain);
      subGain.connect(env);
      sub.start(time);
      sub.stop(time + dur + b.release + 0.03);
    }

    filter.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + dur + b.release + 0.03);
  }

  private synthArpStep(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    midi: number,
    time: number,
    dur: number,
    velocity: number,
    energy: number,
  ): void {
    const a = pack.timbre.arp;
    const osc = ctx.createOscillator();
    osc.type = a.wave;
    osc.frequency.setValueAtTime(midiToFreq(midi), time);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const cut = a.cutoffHz * (0.7 + energy * 0.5);
    filter.frequency.setValueAtTime(cut * 1.35, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(300, cut * 0.4), time + a.decay);

    const env = ctx.createGain();
    const peak = a.gain * velocity;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(peak, time + a.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(a.decay, dur) + a.release);

    osc.connect(filter);
    filter.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + Math.max(a.decay, dur) + a.release + 0.03);
  }

  private synthKick(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    time: number,
    velocity: number,
  ): void {
    const d = pack.timbre.drums;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(d.kickFreqStart, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(28, d.kickFreqEnd), time + d.kickDecay * 0.75);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(d.kickGain * velocity, time + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, time + d.kickDecay + 0.04);

    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + d.kickDecay + 0.06);
  }

  private synthSnare(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    time: number,
    velocity: number,
  ): void {
    const d = pack.timbre.drums;
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(d.snareBandHz, time);
      filter.Q.setValueAtTime(1.1, time);

      const env = ctx.createGain();
      env.gain.setValueAtTime(d.snareGain * velocity, time);
      env.gain.exponentialRampToValueAtTime(0.0001, time + d.snareDecay);

      src.connect(filter);
      filter.connect(env);
      env.connect(dest);
      src.start(time);
      src.stop(time + d.snareDecay + 0.02);
    }

    // Crisp tonal body
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(d.snareToneHz, time);
    body.frequency.exponentialRampToValueAtTime(d.snareToneHz * 0.55, time + 0.06);
    const bodyEnv = ctx.createGain();
    bodyEnv.gain.setValueAtTime(d.snareGain * 0.55 * velocity, time);
    bodyEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.075);

    body.connect(bodyEnv);
    bodyEnv.connect(dest);
    body.start(time);
    body.stop(time + 0.09);
  }

  private synthHat(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    time: number,
    velocity: number,
  ): void {
    if (!this.noiseBuffer) return;
    const d = pack.timbre.drums;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(d.hatHighpassHz, time);

    const env = ctx.createGain();
    env.gain.setValueAtTime(d.hatGain * velocity, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + d.hatDecay);

    src.connect(filter);
    filter.connect(env);
    env.connect(dest);
    src.start(time);
    src.stop(time + d.hatDecay + 0.015);
  }

  private synthPerc(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    time: number,
    velocity: number,
    barStep: number,
  ): void {
    const d = pack.timbre.drums;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const pitchMod = barStep % 8 < 4 ? 1 : 1.189; // subtle wooden interval bounce
    osc.frequency.setValueAtTime(d.percFreqHz * pitchMod, time);
    osc.frequency.exponentialRampToValueAtTime(d.percFreqHz * 0.72, time + d.percDecay);

    const env = ctx.createGain();
    env.gain.setValueAtTime(d.percGain * velocity, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + d.percDecay + 0.015);

    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + d.percDecay + 0.025);
  }

  private synthMoveVoice(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    midi: number,
    velocity: number,
  ): void {
    const s = pack.timbre.sfx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = s.moveWave;
    osc.frequency.setValueAtTime(midiToFreq(midi), now);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(s.moveFilterHz * (0.75 + velocity * 0.5), now);
    filter.frequency.exponentialRampToValueAtTime(480, now + s.moveDecay);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.22 * velocity, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, now + s.moveDecay + 0.04);

    osc.connect(filter);
    filter.connect(env);
    env.connect(dest);
    osc.start(now);
    osc.stop(now + s.moveDecay + 0.06);
  }

  private synthDropVoice(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    bassMidi: number,
    velocity: number,
  ): void {
    const s = pack.timbre.sfx;
    const now = ctx.currentTime;
    const targetFreq = Math.max(40, midiToFreq(bassMidi));

    const osc = ctx.createOscillator();
    osc.type = s.dropWave;
    osc.frequency.setValueAtTime(Math.max(s.dropPunchHz, targetFreq * 2.2), now);
    osc.frequency.exponentialRampToValueAtTime(targetFreq, now + 0.065);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + 0.13);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.36 * velocity, now + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(filter);
    filter.connect(env);
    env.connect(dest);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  private synthClearChordVoice(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    midis: readonly number[],
    clearTier: 0 | 1 | 2,
    velocity: number,
  ): void {
    const s = pack.timbre.sfx;
    const now = ctx.currentTime;
    const spread = clearTier === 2 ? 0.022 : 0.016;
    const tail = 0.36 + clearTier * 0.16;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200 + clearTier * 1400, now);
    filter.frequency.exponentialRampToValueAtTime(950, now + tail);
    filter.connect(dest);

    midis.forEach((midi, idx) => {
      const t = now + idx * spread;
      const freq = midiToFreq(midi);
      const osc = ctx.createOscillator();
      osc.type = s.clearWave;
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.setValueAtTime((idx % 2 === 0 ? -1 : 1) * s.clearShimmerDetune, t);

      const env = ctx.createGain();
      const peak = (0.16 * velocity) / Math.max(1, Math.sqrt(midis.length));
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.014);
      env.gain.exponentialRampToValueAtTime(0.0001, t + tail);

      osc.connect(env);
      env.connect(filter);
      osc.start(t);
      osc.stop(t + tail + 0.03);
    });
  }

  private synthComboChimeVoice(
    ctx: AudioContext,
    dest: AudioNode,
    pack: SynthPackSpec,
    midis: readonly number[],
    comboCount: number,
    velocity: number,
  ): void {
    const s = pack.timbre.sfx;
    const now = ctx.currentTime;
    // Gentle crystalline pitch lift for high chains (capped at +4 semitones)
    const semitoneLift = comboCount >= 5 ? 12 : 0;

    midis.forEach((midi, idx) => {
      const t = now + idx * 0.034;
      const freq = midiToFreq(midi + semitoneLift);
      const osc = ctx.createOscillator();
      osc.type = s.comboWave;
      osc.frequency.setValueAtTime(freq, t);

      const shimmer = ctx.createOscillator();
      shimmer.type = 'sine';
      shimmer.frequency.setValueAtTime(freq * 2, t);

      const env = ctx.createGain();
      const peak = 0.14 * velocity;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

      osc.connect(env);
      shimmer.connect(env);
      env.connect(dest);
      osc.start(t);
      shimmer.start(t);
      osc.stop(t + 0.38);
      shimmer.stop(t + 0.38);
    });
  }
}
