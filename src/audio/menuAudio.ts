/**
 * Krunked Lumia — Procedural Menu Audio & Ambient Menu Loop (with Custom .ogg Override)
 *
 * Synthesizes crisp, musical menu SFX (`menu_move`, cycling pentatonic `menu_select_0..4`,
 * `menu_back`, `fail_sfx`, `tutorial_sfx_start`, `tutorial_sfx_trigger`, `tutorial_sfx_off`)
 * and a serene `menu_loop` ambient pulse (`gain = 0.5`).
 *
 * When a custom audio pack is active, any decoded `.ogg` buffer overrides the corresponding
 * cue seamlessly; missing custom files fall back silently to built-in Web Audio synthesis.
 */

import { resolveAudioBuffer } from './customAudioLoader.js';
import { midiToFreq } from './synthPacks.js';

export const MENU_SFX_IDS = [
  'menu_move',
  'menu_select_0',
  'menu_select_1',
  'menu_select_2',
  'menu_select_3',
  'menu_select_4',
  'menu_back',
  'fail_sfx',
  'tutorial_sfx_start',
  'tutorial_sfx_trigger',
  'tutorial_sfx_off',
] as const;

export type MenuSfxId = (typeof MENU_SFX_IDS)[number];

/** Extracted Menu Loop ambient gain level. */
export const MENU_LOOP_GAIN = 0.5;

/** Cycling pentatonic harmonic confirms for menu_select_0..4 (C major pentatonic pairs). */
const SELECT_PENTATONIC_CHORDS: readonly (readonly [number, number])[] = [
  [72, 79], // C5 + G5
  [74, 81], // D5 + A5
  [76, 83], // E5 + B5
  [79, 86], // G5 + D6
  [81, 88], // A5 + E6
] as const;

/** Serene 4-chord ambient progression for the procedural menu loop (84 BPM). */
const MENU_AMBIENT_CHORDS: readonly (readonly number[])[] = [
  [48, 55, 59, 62, 64], // Cmaj9
  [53, 57, 60, 64, 67], // Fmaj9
  [45, 52, 55, 59, 64], // Am9
  [43, 50, 55, 59, 64], // G6
] as const;

const MENU_LOOP_BPM = 84;
const MENU_LOOP_BEATS = 16; // 4 bars, 1 bar per chord
const MENU_LOOKAHEAD_SEC = 0.14;
const MENU_SCHEDULER_MS = 35;

export interface AudioBusProvider {
  getContext: () => AudioContext | null;
  getDestination: () => AudioNode | null;
}

export class MenuAudioController {
  private readonly bus: AudioBusProvider;
  private customBuffers: Map<string, AudioBuffer> | null = null;
  private selectCycleIndex = 0;

  private menuLoopActive = false;
  private menuLoopGainNode: GainNode | null = null;
  private customLoopSource: AudioBufferSourceNode | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private loopStartTime = 0;
  private loopElapsedHeadless = 0;
  private lastScheduledBeat = -1;
  private lastPlayedId: MenuSfxId | null = null;

  constructor(bus: AudioBusProvider) {
    this.bus = bus;
  }

  /** Attach or clear custom decoded menu `.ogg` buffers. */
  public setCustomBuffers(buffers: Map<string, AudioBuffer> | null): void {
    const wasPlaying = this.menuLoopActive;
    this.customBuffers = buffers;
    if (wasPlaying) {
      this.stopMenuLoop();
      this.startMenuLoop();
    }
  }

  public getSelectCycleIndex(): number {
    return this.selectCycleIndex;
  }

  public getLastPlayedSfx(): MenuSfxId | null {
    return this.lastPlayedId;
  }

  public isMenuLoopPlaying(): boolean {
    return this.menuLoopActive;
  }

  public getLoopElapsed(): number {
    return this.loopElapsedHeadless;
  }

  /** Play any menu sound effect by ID, using custom `.ogg` override if available. */
  public play(id: MenuSfxId): void {
    this.lastPlayedId = id;
    const ctx = this.bus.getContext();
    const dest = this.bus.getDestination();
    if (!ctx || !dest) return;

    const customBuf = resolveAudioBuffer(this.customBuffers, id);
    if (customBuf) {
      this.playBufferOneShot(ctx, dest, customBuf, id === 'fail_sfx' ? 0.85 : 0.72);
      return;
    }

    this.synthesizeMenuSfx(ctx, dest, id);
  }

  public playMove(): void {
    this.play('menu_move');
  }

  /** Play cycling pentatonic confirm (`menu_select_0..4`). */
  public playSelect(explicitIndex?: number): MenuSfxId {
    const idx =
      explicitIndex !== undefined
        ? ((Math.floor(explicitIndex) % 5) + 5) % 5
        : this.selectCycleIndex;
    const id = `menu_select_${idx}` as MenuSfxId;
    if (explicitIndex === undefined) {
      this.selectCycleIndex = (this.selectCycleIndex + 1) % 5;
    }
    this.play(id);
    return id;
  }

  public playBack(): void {
    this.play('menu_back');
  }

  public playFail(): void {
    this.play('fail_sfx');
  }

  public playTutorialStart(): void {
    this.play('tutorial_sfx_start');
  }

  public playTutorialTrigger(): void {
    this.play('tutorial_sfx_trigger');
  }

  public playTutorialOff(): void {
    this.play('tutorial_sfx_off');
  }

  /** Start the gentle ambient `menu_loop` at `gain = 0.5`. */
  public startMenuLoop(): void {
    if (this.menuLoopActive) return;
    this.menuLoopActive = true;
    this.loopElapsedHeadless = 0;
    this.lastScheduledBeat = -1;

    const ctx = this.bus.getContext();
    const dest = this.bus.getDestination();
    if (!ctx || !dest) return;

    this.ensureLoopGainNode(ctx, dest);
    const loopGain = this.menuLoopGainNode!;
    const now = ctx.currentTime;
    loopGain.gain.cancelScheduledValues(now);
    loopGain.gain.setValueAtTime(0.0001, now);
    loopGain.gain.linearRampToValueAtTime(MENU_LOOP_GAIN, now + 0.16);

    const customLoopBuf = resolveAudioBuffer(this.customBuffers, 'menu_loop');
    if (customLoopBuf) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = customLoopBuf;
        src.loop = true;
        src.connect(loopGain);
        src.start(now);
        this.customLoopSource = src;
        return;
      } catch {
        this.customLoopSource = null;
      }
    }

    // Procedural serene ambient menu pulse
    this.loopStartTime = now + 0.03;
    this.scheduleProceduralMenuBeats();
    this.loopTimer = setInterval(() => {
      this.scheduleProceduralMenuBeats();
    }, MENU_SCHEDULER_MS);
  }

  /** Stop the menu ambient loop cleanly. */
  public stopMenuLoop(): void {
    this.menuLoopActive = false;
    if (this.loopTimer !== null) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }

    if (this.customLoopSource) {
      try {
        this.customLoopSource.stop();
        this.customLoopSource.disconnect();
      } catch {
        // Ignore already-stopped source
      }
      this.customLoopSource = null;
    }

    const ctx = this.bus.getContext();
    if (ctx && this.menuLoopGainNode) {
      const now = ctx.currentTime;
      this.menuLoopGainNode.gain.cancelScheduledValues(now);
      this.menuLoopGainNode.gain.setTargetAtTime(0.0001, now, 0.04);
    }
  }

  /** Advance internal menu loop clock (safe in headless environments). */
  public update(dtSec: number): void {
    if (!this.menuLoopActive || dtSec <= 0 || !Number.isFinite(dtSec)) return;
    const ctx = this.bus.getContext();
    if (ctx && ctx.state === 'running') {
      if (!this.customLoopSource) {
        this.scheduleProceduralMenuBeats();
      }
      return;
    }
    const loopLenSec = (60 / MENU_LOOP_BPM) * MENU_LOOP_BEATS;
    this.loopElapsedHeadless = (this.loopElapsedHeadless + dtSec) % loopLenSec;
  }

  public dispose(): void {
    this.stopMenuLoop();
    if (this.menuLoopGainNode) {
      try {
        this.menuLoopGainNode.disconnect();
      } catch {
        // Ignore
      }
      this.menuLoopGainNode = null;
    }
    this.customBuffers = null;
  }

  private ensureLoopGainNode(ctx: AudioContext, dest: AudioNode): void {
    if (this.menuLoopGainNode && this.menuLoopGainNode.context === ctx) {
      return;
    }
    this.menuLoopGainNode = ctx.createGain();
    this.menuLoopGainNode.gain.setValueAtTime(MENU_LOOP_GAIN, ctx.currentTime);
    this.menuLoopGainNode.connect(dest);
  }

  private playBufferOneShot(
    ctx: AudioContext,
    dest: AudioNode,
    buffer: AudioBuffer,
    gainLevel: number,
  ): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(gainLevel, ctx.currentTime);
      src.connect(gain);
      gain.connect(dest);
      src.start(ctx.currentTime);
    } catch {
      // Ignore audio node errors
    }
  }

  private scheduleProceduralMenuBeats(): void {
    if (!this.menuLoopActive) return;
    const ctx = this.bus.getContext();
    const dest = this.bus.getDestination();
    if (!ctx || !dest || ctx.state !== 'running') return;

    this.ensureLoopGainNode(ctx, dest);
    const loopGain = this.menuLoopGainNode!;
    const beatDur = 60 / MENU_LOOP_BPM;
    const now = ctx.currentTime;
    const horizon = now + MENU_LOOKAHEAD_SEC;

    while (true) {
      const nextBeat = this.lastScheduledBeat + 1;
      const beatTime = this.loopStartTime + nextBeat * beatDur;
      if (beatTime > horizon) break;
      this.lastScheduledBeat = nextBeat;

      // Skip ancient beats if tab was backgrounded
      if (beatTime < now - 0.1) continue;

      const beatInLoop = nextBeat % MENU_LOOP_BEATS;
      const barIndex = Math.floor(beatInLoop / 4) % MENU_AMBIENT_CHORDS.length;
      const beatInBar = beatInLoop % 4;
      const chord = MENU_AMBIENT_CHORDS[barIndex];

      // Downbeat warm breathing ambient pad chord
      if (beatInBar === 0) {
        this.scheduleAmbientPad(ctx, loopGain, chord, beatTime, beatDur * 3.85);
      }

      // Soft warm pulse tone on beats 0 and 2
      if (beatInBar === 0 || beatInBar === 2) {
        this.scheduleSoftTone(
          ctx,
          loopGain,
          midiToFreq(chord[0]),
          beatTime,
          beatDur * 1.4,
          beatInBar === 0 ? 0.14 : 0.08,
          'sine',
        );
      }

      // Delicate glassy arpeggio sparkle on offbeats
      if (beatInBar === 1 || beatInBar === 3) {
        const note = chord[(barIndex + beatInBar) % chord.length] + 12;
        this.scheduleSoftTone(
          ctx,
          loopGain,
          midiToFreq(note),
          beatTime + beatDur * 0.5,
          0.45,
          0.065,
          'triangle',
        );
      }
    }
  }

  private scheduleAmbientPad(
    ctx: AudioContext,
    dest: AudioNode,
    midis: readonly number[],
    startTime: number,
    duration: number,
  ): void {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1150, startTime);
    filter.Q.setValueAtTime(0.7, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(0.11, startTime + Math.min(0.45, duration * 0.3));
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    filter.connect(env);
    env.connect(dest);

    for (let i = 0; i < midis.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(midiToFreq(midis[i]), startTime);
      osc.detune.setValueAtTime((i % 2 === 0 ? -1 : 1) * 5, startTime);
      osc.connect(filter);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    }
  }

  private scheduleSoftTone(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    startTime: number,
    duration: number,
    peakGain: number,
    type: OscillatorType,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.03);
  }

  private synthesizeMenuSfx(ctx: AudioContext, dest: AudioNode, id: MenuSfxId): void {
    const now = ctx.currentTime;

    switch (id) {
      case 'menu_move': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(784, now);
        osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.038);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.16, now + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now);
        osc.stop(now + 0.065);
        break;
      }

      case 'menu_select_0':
      case 'menu_select_1':
      case 'menu_select_2':
      case 'menu_select_3':
      case 'menu_select_4': {
        const idx = Number(id.slice(-1));
        const [n1, n2] = SELECT_PENTATONIC_CHORDS[idx] ?? SELECT_PENTATONIC_CHORDS[0];
        this.scheduleSoftTone(ctx, dest, midiToFreq(n1), now, 0.18, 0.2, 'triangle');
        this.scheduleSoftTone(ctx, dest, midiToFreq(n2), now + 0.028, 0.24, 0.16, 'sine');
        break;
      }

      case 'menu_back': {
        this.scheduleSoftTone(ctx, dest, midiToFreq(79), now, 0.09, 0.16, 'triangle');
        this.scheduleSoftTone(ctx, dest, midiToFreq(74), now + 0.045, 0.15, 0.18, 'sine');
        break;
      }

      case 'fail_sfx': {
        // Descending minor cadence + low filtered thud
        const notes = [67, 63, 60, 55];
        notes.forEach((midi, idx) => {
          const t = now + idx * 0.075;
          this.scheduleSoftTone(ctx, dest, midiToFreq(midi), t, 0.28, 0.16 - idx * 0.015, 'triangle');
        });
        const sub = ctx.createOscillator();
        const subGain = ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(110, now);
        sub.frequency.exponentialRampToValueAtTime(42, now + 0.42);
        subGain.gain.setValueAtTime(0.0001, now);
        subGain.gain.linearRampToValueAtTime(0.28, now + 0.015);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
        sub.connect(subGain);
        subGain.connect(dest);
        sub.start(now);
        sub.stop(now + 0.5);
        break;
      }

      case 'tutorial_sfx_start': {
        const chime = [72, 76, 79];
        chime.forEach((midi, idx) => {
          this.scheduleSoftTone(ctx, dest, midiToFreq(midi), now + idx * 0.055, 0.22, 0.16, 'sine');
        });
        break;
      }

      case 'tutorial_sfx_trigger': {
        this.scheduleSoftTone(ctx, dest, midiToFreq(79), now, 0.16, 0.18, 'triangle');
        this.scheduleSoftTone(ctx, dest, midiToFreq(86), now + 0.032, 0.24, 0.16, 'sine');
        break;
      }

      case 'tutorial_sfx_off': {
        this.scheduleSoftTone(ctx, dest, midiToFreq(76), now, 0.14, 0.14, 'sine');
        this.scheduleSoftTone(ctx, dest, midiToFreq(72), now + 0.055, 0.2, 0.15, 'sine');
        break;
      }
    }
  }
}
