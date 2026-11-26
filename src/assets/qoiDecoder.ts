/**
 * Krunked Lumia — Pure TypeScript BZip2, GameMaker QOI v0 (`fioq` / `2zoq`), and PNG Codec
 *
 * 100% browser- and Node-compatible with ZERO Node-only imports and ZERO external packages.
 * Enables zero-backend in-browser decoding of retail `data.win` `2zoq` textures as well as
 * local Node CLI extraction via `tools/extract-assets.ts`.
 */

export interface DecodedImage {
  width: number;
  height: number;
  pixels: Uint8Array; // RGBA8888, length = width * height * 4
}

// ============================================================================
// 1. PURE-TS BZIP2 STREAM DECOMPRESSOR (BZh[1-9])
// ============================================================================

const BZIP2_BLOCK_MAGIC_HI = 0x314159;
const BZIP2_BLOCK_MAGIC_LO = 0x265359;
const BZIP2_EOS_MAGIC_HI = 0x177245;
const BZIP2_EOS_MAGIC_LO = 0x385090;

/** MSB-first CRC-32 table used by BZip2 (polynomial 0x04C11DB7, non-reflected). */
const BZIP2_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 24;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x80000000) !== 0) {
        crc = ((crc << 1) ^ 0x04c11db7) >>> 0;
      } else {
        crc = (crc << 1) >>> 0;
      }
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

/** Standard IEEE 802.3 LSB-first CRC-32 table used by PNG chunks (polynomial 0xEDB88320). */
const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) !== 0 ? (0xedb88320 ^ (crc >>> 1)) >>> 0 : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

/** Classic BZip2 legacy randomization table (rarely set, included for full spec compliance). */
const BZ2_RNUMS = new Uint16Array([
  619, 720, 127, 481, 931, 816, 813, 233, 566, 247, 985, 724, 205, 454, 863, 491,
  741, 242, 949, 214, 733, 859, 335, 708, 621, 574, 73, 654, 730, 472, 419, 436,
  278, 496, 867, 210, 399, 680, 480, 51, 878, 465, 811, 169, 869, 675, 611, 697,
  867, 561, 862, 687, 507, 283, 482, 129, 807, 591, 733, 623, 150, 238, 59, 379,
  684, 877, 625, 169, 643, 105, 170, 607, 520, 932, 727, 476, 693, 425, 174, 647,
  73, 122, 335, 530, 442, 853, 695, 249, 445, 515, 909, 545, 703, 919, 874, 474,
  882, 500, 594, 612, 641, 801, 220, 162, 819, 984, 589, 513, 495, 799, 161, 604,
  958, 533, 221, 400, 386, 867, 600, 782, 382, 596, 414, 171, 516, 375, 682, 485,
  911, 276, 98, 553, 163, 354, 666, 933, 424, 341, 533, 870, 227, 730, 475, 186,
  263, 647, 537, 686, 600, 224, 469, 68, 770, 919, 190, 373, 294, 822, 808, 206,
  184, 943, 795, 384, 383, 461, 404, 758, 839, 887, 715, 67, 618, 276, 204, 918,
  873, 777, 604, 560, 951, 160, 578, 722, 79, 804, 96, 409, 713, 940, 652, 934,
  970, 447, 318, 353, 859, 672, 112, 785, 645, 863, 803, 350, 139, 93, 354, 99,
  820, 908, 609, 772, 154, 274, 580, 184, 79, 626, 630, 742, 653, 282, 762, 623,
  680, 81, 927, 626, 789, 125, 411, 521, 938, 300, 821, 78, 343, 175, 128, 250,
  170, 774, 972, 275, 999, 639, 495, 78, 352, 126, 857, 956, 358, 619, 580, 124,
  737, 594, 701, 612, 669, 112, 134, 694, 363, 992, 809, 743, 168, 974, 944, 375,
  748, 52, 600, 747, 642, 182, 862, 81, 344, 805, 988, 739, 511, 655, 814, 334,
  249, 515, 897, 955, 664, 981, 649, 113, 974, 459, 893, 228, 433, 837, 553, 268,
  926, 240, 102, 654, 459, 51, 686, 754, 806, 760, 493, 403, 415, 394, 687, 700,
  946, 670, 656, 610, 738, 392, 760, 799, 887, 653, 978, 321, 576, 617, 626, 502,
  894, 679, 243, 440, 680, 879, 194, 572, 640, 724, 926, 56, 204, 700, 707, 151,
  457, 449, 797, 195, 791, 558, 945, 679, 297, 59, 87, 824, 713, 663, 412, 693,
  342, 606, 134, 108, 571, 364, 631, 212, 174, 643, 304, 329, 343, 97, 430, 751,
  497, 314, 983, 374, 822, 928, 140, 206, 73, 263, 980, 736, 876, 478, 430, 305,
  170, 514, 364, 692, 829, 82, 855, 953, 676, 246, 369, 970, 294, 750, 807, 827,
  150, 790, 288, 923, 804, 378, 215, 828, 592, 281, 565, 555, 710, 82, 896, 831,
  547, 261, 524, 462, 293, 465, 502, 56, 661, 821, 976, 991, 658, 869, 905, 758,
  745, 193, 768, 550, 608, 933, 378, 286, 215, 979, 792, 961, 61, 688, 793, 644,
  986, 403, 106, 366, 905, 644, 372, 567, 466, 434, 645, 210, 389, 550, 919, 135,
  780, 773, 635, 389, 707, 100, 626, 958, 165, 504, 920, 176, 193, 713, 857, 265,
  203, 50, 668, 108, 645, 990, 626, 197, 510, 357, 358, 850, 858, 364, 936, 638,
]);

class MsbBitReader {
  private readonly data: Uint8Array;
  private bytePos = 0;
  private bitBuf = 0;
  private bitCount = 0;

  constructor(data: Uint8Array, startOffset = 0) {
    this.data = data;
    this.bytePos = startOffset;
  }

  readBits(n: number): number {
    while (this.bitCount < n) {
      if (this.bytePos >= this.data.length) {
        throw new Error('Unexpected end of BZip2 bitstream');
      }
      this.bitBuf = ((this.bitBuf << 8) | this.data[this.bytePos++]) >>> 0;
      this.bitCount += 8;
    }
    this.bitCount -= n;
    const mask = n === 32 ? 0xffffffff : (1 << n) - 1;
    return (this.bitBuf >>> this.bitCount) & mask;
  }

  readBit(): number {
    if (this.bitCount === 0) {
      if (this.bytePos >= this.data.length) {
        throw new Error('Unexpected end of BZip2 bitstream');
      }
      this.bitBuf = this.data[this.bytePos++];
      this.bitCount = 8;
    }
    this.bitCount -= 1;
    return (this.bitBuf >>> this.bitCount) & 1;
  }

  readU32(): number {
    const hi = this.readBits(16);
    const lo = this.readBits(16);
    return ((hi << 16) | lo) >>> 0;
  }
}

interface HuffmanDecodeTable {
  minLen: number;
  maxLen: number;
  limit: Int32Array;
  base: Int32Array;
  perm: Uint16Array;
}

function buildBzip2HuffmanTable(lengths: Uint8Array, alphaSize: number): HuffmanDecodeTable {
  let minLen = 23;
  let maxLen = 0;
  for (let i = 0; i < alphaSize; i++) {
    const len = lengths[i];
    if (len < minLen) minLen = len;
    if (len > maxLen) maxLen = len;
  }
  if (minLen < 1 || maxLen > 20) {
    throw new Error(`Invalid BZip2 Huffman bit length range [${minLen}, ${maxLen}]`);
  }

  const perm = new Uint16Array(alphaSize);
  let pp = 0;
  for (let len = minLen; len <= maxLen; len++) {
    for (let sym = 0; sym < alphaSize; sym++) {
      if (lengths[sym] === len) {
        perm[pp++] = sym;
      }
    }
  }

  const base = new Int32Array(23);
  const limit = new Int32Array(23);

  for (let sym = 0; sym < alphaSize; sym++) {
    base[lengths[sym] + 1]++;
  }
  for (let i = 1; i < 23; i++) {
    base[i] += base[i - 1];
  }

  let vec = 0;
  for (let len = minLen; len <= maxLen; len++) {
    vec += base[len + 1] - base[len];
    limit[len] = vec - 1;
    vec <<= 1;
  }
  for (let len = minLen + 1; len <= maxLen; len++) {
    base[len] = ((limit[len - 1] + 1) << 1) - base[len];
  }

  return { minLen, maxLen, limit, base, perm };
}

class DynamicByteBuffer {
  private buf: Uint8Array;
  private len = 0;

  constructor(initialCapacity = 65536) {
    this.buf = new Uint8Array(initialCapacity);
  }

  push(byte: number): void {
    if (this.len >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = byte;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/**
 * Pure-TypeScript BZip2 stream decompressor supporting standard `BZh[1-9]` streams.
 * Verifies per-block and combined stream CRC-32 checksums.
 */
export function decompressBzip2(input: Uint8Array): Uint8Array {
  if (input.length < 10) {
    throw new Error('BZip2 stream too short');
  }
  if (input[0] !== 0x42 || input[1] !== 0x5a || input[2] !== 0x68) {
    throw new Error('Invalid BZip2 magic header (expected "BZh")');
  }
  const blockSize100k = input[3] - 0x30;
  if (blockSize100k < 1 || blockSize100k > 9) {
    throw new Error(`Invalid BZip2 block size level: ${blockSize100k}`);
  }

  const maxBlockSize = blockSize100k * 100_000;
  const reader = new MsbBitReader(input, 4);
  const output = new DynamicByteBuffer(Math.min(maxBlockSize, Math.max(65536, input.length * 4)));

  // Reusable per-block scratch buffers
  const bwtBytes = new Uint8Array(maxBlockSize);
  const seqToUnseq = new Uint8Array(256);
  const mtf = new Uint8Array(256);
  const unzftab = new Int32Array(256);
  const cftab = new Int32Array(257);

  let computedCombinedCrc = 0;

  while (true) {
    const magicHi = reader.readBits(24);
    const magicLo = reader.readBits(24);

    if (magicHi === BZIP2_EOS_MAGIC_HI && magicLo === BZIP2_EOS_MAGIC_LO) {
      const storedCombinedCrc = reader.readU32();
      if ((computedCombinedCrc >>> 0) !== (storedCombinedCrc >>> 0)) {
        throw new Error(
          `BZip2 combined CRC mismatch: expected 0x${storedCombinedCrc.toString(16)}, got 0x${computedCombinedCrc.toString(16)}`,
        );
      }
      break;
    }

    if (magicHi !== BZIP2_BLOCK_MAGIC_HI || magicLo !== BZIP2_BLOCK_MAGIC_LO) {
      throw new Error(
        `Invalid BZip2 block magic: 0x${magicHi.toString(16).padStart(6, '0')}${magicLo.toString(16).padStart(6, '0')}`,
      );
    }

    const storedBlockCrc = reader.readU32();
    const randomised = reader.readBit() === 1;
    const origPtr = reader.readBits(24);

    // 1. Read active symbol bitmap
    const inUse16 = reader.readBits(16);
    let nInUse = 0;
    for (let i = 0; i < 16; i++) {
      if ((inUse16 & (1 << (15 - i))) !== 0) {
        const chunk = reader.readBits(16);
        for (let j = 0; j < 16; j++) {
          if ((chunk & (1 << (15 - j))) !== 0) {
            seqToUnseq[nInUse++] = (i << 4) | j;
          }
        }
      }
    }
    if (nInUse === 0) {
      throw new Error('BZip2 block has zero active symbols');
    }

    const alphaSize = nInUse + 2;
    const eobSym = nInUse + 1;

    // 2. Read Huffman groups and MTF-encoded selector list
    const nGroups = reader.readBits(3);
    if (nGroups < 2 || nGroups > 6) {
      throw new Error(`Invalid BZip2 Huffman group count: ${nGroups}`);
    }
    const nSelectors = reader.readBits(15);
    if (nSelectors < 1) {
      throw new Error('Invalid BZip2 selector count: 0');
    }

    const selectorMtf = new Uint8Array(nSelectors);
    for (let i = 0; i < nSelectors; i++) {
      let j = 0;
      while (reader.readBit() === 1) {
        j++;
        if (j >= nGroups) {
          throw new Error('BZip2 selector MTF index out of range');
        }
      }
      selectorMtf[i] = j;
    }

    const pos = new Uint8Array(nGroups);
    for (let i = 0; i < nGroups; i++) pos[i] = i;

    const selectors = new Uint8Array(nSelectors);
    for (let i = 0; i < nSelectors; i++) {
      const idx = selectorMtf[i];
      const tmp = pos[idx];
      for (let k = idx; k > 0; k--) {
        pos[k] = pos[k - 1];
      }
      pos[0] = tmp;
      selectors[i] = tmp;
    }

    // 3. Read delta-coded Huffman bit lengths and build canonical decode tables
    const tables: HuffmanDecodeTable[] = [];
    const lengths = new Uint8Array(alphaSize);
    for (let t = 0; t < nGroups; t++) {
      let curr = reader.readBits(5);
      for (let sym = 0; sym < alphaSize; sym++) {
        while (true) {
          if (curr < 1 || curr > 20) {
            throw new Error(`Invalid BZip2 Huffman code length: ${curr}`);
          }
          if (reader.readBit() === 0) break;
          curr += reader.readBit() === 0 ? 1 : -1;
        }
        lengths[sym] = curr;
      }
      tables.push(buildBzip2HuffmanTable(lengths, alphaSize));
    }

    // 4. Decode Huffman + RLE2 + MTF into bwtBytes[0..nblock-1]
    unzftab.fill(0);
    for (let i = 0; i < nInUse; i++) mtf[i] = i;

    let groupNo = -1;
    let groupPos = 0;
    let activeTable = tables[selectors[0]];

    const readHuffSymbol = (): number => {
      if (groupPos === 0) {
        groupNo += 1;
        if (groupNo >= nSelectors) {
          throw new Error('BZip2 exceeded Huffman selector list');
        }
        activeTable = tables[selectors[groupNo]];
        groupPos = 50;
      }
      groupPos -= 1;

      let zn = activeTable.minLen;
      let zvec = reader.readBits(zn);
      while (zvec > activeTable.limit[zn]) {
        zn += 1;
        if (zn > activeTable.maxLen) {
          throw new Error('BZip2 Huffman symbol exceeded max bit length');
        }
        zvec = (zvec << 1) | reader.readBit();
      }
      const permIdx = zvec - activeTable.base[zn];
      if (permIdx < 0 || permIdx >= alphaSize) {
        throw new Error(`BZip2 Huffman perm index out of range: ${permIdx}`);
      }
      return activeTable.perm[permIdx];
    };

    let nblock = 0;
    let sym = readHuffSymbol();
    while (sym !== eobSym) {
      if (sym === 0 || sym === 1) {
        // Bijective base-2 RLE2 run of mtf[0]
        let runLen = 0;
        let power = 1;
        while (sym === 0 || sym === 1) {
          runLen += sym === 0 ? power : power << 1;
          power <<= 1;
          sym = readHuffSymbol();
        }
        if (nblock + runLen > maxBlockSize) {
          throw new Error('BZip2 block overflow during RLE2 expansion');
        }
        const ch = seqToUnseq[mtf[0]];
        unzftab[ch] += runLen;
        bwtBytes.fill(ch, nblock, nblock + runLen);
        nblock += runLen;
      } else {
        if (nblock >= maxBlockSize) {
          throw new Error('BZip2 block overflow');
        }
        const mtfIdx = sym - 1;
        const val = mtf[mtfIdx];
        for (let k = mtfIdx; k > 0; k--) {
          mtf[k] = mtf[k - 1];
        }
        mtf[0] = val;
        const ch = seqToUnseq[val];
        unzftab[ch] += 1;
        bwtBytes[nblock++] = ch;
        sym = readHuffSymbol();
      }
    }

    if (origPtr >= nblock && nblock > 0) {
      throw new Error(`Invalid BZip2 origPtr ${origPtr} for block length ${nblock}`);
    }

    // 5. Inverse Burrows-Wheeler Transform
    cftab[0] = 0;
    for (let i = 1; i <= 256; i++) {
      cftab[i] = cftab[i - 1] + unzftab[i - 1];
    }

    const tt = new Uint32Array(nblock);
    for (let i = 0; i < nblock; i++) {
      const ch = bwtBytes[i];
      tt[cftab[ch]++] = i;
    }

    // 6. Walk BWT chain + RLE1 expansion + per-block CRC-32 verification
    let blockCrc = 0xffffffff;
    const emitByte = (b: number): void => {
      output.push(b);
      blockCrc = (((blockCrc << 8) >>> 0) ^ BZIP2_CRC_TABLE[((blockCrc >>> 24) ^ b) & 0xff]) >>> 0;
    };

    let tPos = nblock > 0 ? tt[origPtr] : 0;
    let rNToGo = 0;
    let rTPos = 0;

    let lastByte = -1;
    let runCount = 0;
    let awaitingRepeatByte = false;

    for (let i = 0; i < nblock; i++) {
      let ch = bwtBytes[tPos];
      tPos = tt[tPos];

      if (randomised) {
        if (rNToGo === 0) {
          rNToGo = BZ2_RNUMS[rTPos];
          rTPos = (rTPos + 1) & 511;
        }
        rNToGo -= 1;
        if (rNToGo === 1) {
          ch ^= 1;
        }
      }

      if (awaitingRepeatByte) {
        for (let r = 0; r < ch; r++) {
          emitByte(lastByte);
        }
        awaitingRepeatByte = false;
        lastByte = -1;
        runCount = 0;
      } else {
        emitByte(ch);
        if (ch === lastByte) {
          runCount += 1;
          if (runCount === 4) {
            awaitingRepeatByte = true;
          }
        } else {
          lastByte = ch;
          runCount = 1;
        }
      }
    }

    const finalBlockCrc = (~blockCrc) >>> 0;
    if (finalBlockCrc !== (storedBlockCrc >>> 0)) {
      throw new Error(
        `BZip2 block CRC mismatch: expected 0x${storedBlockCrc.toString(16)}, got 0x${finalBlockCrc.toString(16)}`,
      );
    }

    computedCombinedCrc =
      ((((computedCombinedCrc << 1) | (computedCombinedCrc >>> 31)) >>> 0) ^ finalBlockCrc) >>> 0;
  }

  return output.toUint8Array();
}

// ============================================================================
// 2. GAMEMAKER QOI v0 (`fioq`) AND `2zoq` TEXTURE DECODER / ENCODER
// ============================================================================

function readU16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  );
}

function writeU16LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
}

function writeU32LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
  buf[offset + 2] = (val >>> 16) & 0xff;
  buf[offset + 3] = (val >>> 24) & 0xff;
}

function writeU32BE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

/**
 * Decodes a GameMaker QOI v0 (`fioq`) RGBA8888 texture buffer.
 *
 * Exact verified GM-QOI v0 specification (GMS 2.3+ / UndertaleModTool `QoiConverter`):
 * - Header (12 bytes): ASCII `'fioq'`, `uint16LE width`, `uint16LE height`, `uint32LE dataLen`
 * - Initial pixel: `(0, 0, 0, 255)`, 64-entry RGBA index table zero-initialized
 * - Hash: `(r ^ g ^ b ^ a) & 63`
 * - Opcodes:
 *   - `00xxxxxx`: INDEX64 (`index[b & 63]`)
 *   - `010xxxxx`: RUN8 (`(b & 31) + 1` repeats of current pixel)
 *   - `011xxxxx` + 1 byte: RUN16 (`(((b & 31) << 8) | next) + 33` repeats)
 *   - `10xxxxxx`: DIFF8 (2-bit two's-complement signed deltas for r, g, b)
 *   - `110xxxxx` + 1 byte: DIFF16 (5/4/4-bit two's-complement signed deltas for r, g, b)
 *   - `1110xxxx` + 2 bytes: DIFF24 (5/5/5/5-bit two's-complement signed deltas for r, g, b, a)
 *   - `1111xxxx` + channel bytes: COLOR (bit3=r, bit2=g, bit1=b, bit0=a)
 */
export function decodeGmQoi(buf: Uint8Array): DecodedImage {
  if (buf.length < 12) {
    throw new Error('GM-QOI buffer too short (< 12 bytes)');
  }
  if (buf[0] !== 0x66 || buf[1] !== 0x69 || buf[2] !== 0x6f || buf[3] !== 0x71) {
    throw new Error('Invalid GM-QOI magic header (expected "fioq")');
  }

  const width = readU16LE(buf, 4);
  const height = readU16LE(buf, 6);
  const dataLen = readU32LE(buf, 8);
  const endPos = Math.min(buf.length, 12 + dataLen);

  if (width === 0 || height === 0) {
    throw new Error(`Invalid GM-QOI dimensions: ${width}x${height}`);
  }

  const totalPixels = width * height;
  const pixels = new Uint8Array(totalPixels * 4);
  const indexR = new Uint8Array(64);
  const indexG = new Uint8Array(64);
  const indexB = new Uint8Array(64);
  const indexA = new Uint8Array(64);

  let r = 0;
  let g = 0;
  let b = 0;
  let a = 255;

  let pos = 12;
  let pxOut = 0;
  const outEnd = totalPixels * 4;

  while (pos < endPos && pxOut < outEnd) {
    const b1 = buf[pos++];

    if ((b1 & 0xc0) === 0x00) {
      // INDEX64: 00xxxxxx
      const idx = b1 & 0x3f;
      r = indexR[idx];
      g = indexG[idx];
      b = indexB[idx];
      a = indexA[idx];
      pixels[pxOut++] = r;
      pixels[pxOut++] = g;
      pixels[pxOut++] = b;
      pixels[pxOut++] = a;
      continue;
    }

    if ((b1 & 0xe0) === 0x40) {
      // RUN8: 010xxxxx -> (b1 & 31) + 1 repeats
      let run = (b1 & 0x1f) + 1;
      while (run-- > 0 && pxOut < outEnd) {
        pixels[pxOut++] = r;
        pixels[pxOut++] = g;
        pixels[pxOut++] = b;
        pixels[pxOut++] = a;
      }
      continue;
    }

    if ((b1 & 0xe0) === 0x60) {
      // RUN16: 011xxxxx + 1 byte -> (((b1 & 31) << 8) | b2) + 33 repeats
      if (pos >= endPos) {
        throw new Error('Truncated GM-QOI RUN16 opcode');
      }
      const b2 = buf[pos++];
      let run = (((b1 & 0x1f) << 8) | b2) + 33;
      while (run-- > 0 && pxOut < outEnd) {
        pixels[pxOut++] = r;
        pixels[pxOut++] = g;
        pixels[pxOut++] = b;
        pixels[pxOut++] = a;
      }
      continue;
    }

    if ((b1 & 0xc0) === 0x80) {
      // DIFF8: 10_rr_gg_bb (2-bit signed two's complement per channel)
      const dr = ((b1 & 0x30) << 26) >> 30;
      const dg = ((b1 & 0x0c) << 28) >> 30;
      const db = ((b1 & 0x03) << 30) >> 30;
      r = (r + dr) & 0xff;
      g = (g + dg) & 0xff;
      b = (b + db) & 0xff;
    } else if ((b1 & 0xe0) === 0xc0) {
      // DIFF16: 110_rrrrr gggg_bbbb (5/4/4-bit signed two's complement)
      if (pos >= endPos) {
        throw new Error('Truncated GM-QOI DIFF16 opcode');
      }
      const b2 = buf[pos++];
      const dr = ((b1 & 0x1f) << 27) >> 27;
      const dg = ((b2 & 0xf0) << 24) >> 28;
      const db = ((b2 & 0x0f) << 28) >> 28;
      r = (r + dr) & 0xff;
      g = (g + dg) & 0xff;
      b = (b + db) & 0xff;
    } else if ((b1 & 0xf0) === 0xe0) {
      // DIFF24: 1110_rrrr rggg_ggbb bbba_aaaa (5/5/5/5-bit signed two's complement)
      if (pos + 1 >= endPos) {
        throw new Error('Truncated GM-QOI DIFF24 opcode');
      }
      const b2 = buf[pos++];
      const b3 = buf[pos++];
      const merged = (b1 << 16) | (b2 << 8) | b3;
      const dr = (((merged >>> 15) & 0x1f) << 27) >> 27;
      const dg = (((merged >>> 10) & 0x1f) << 27) >> 27;
      const db = (((merged >>> 5) & 0x1f) << 27) >> 27;
      const da = ((merged & 0x1f) << 27) >> 27;
      r = (r + dr) & 0xff;
      g = (g + dg) & 0xff;
      b = (b + db) & 0xff;
      a = (a + da) & 0xff;
    } else {
      // COLOR: 1111_rgba (bit3=r, bit2=g, bit1=b, bit0=a)
      if ((b1 & 8) !== 0) r = buf[pos++];
      if ((b1 & 4) !== 0) g = buf[pos++];
      if ((b1 & 2) !== 0) b = buf[pos++];
      if ((b1 & 1) !== 0) a = buf[pos++];
    }

    const hashIdx = (r ^ g ^ b ^ a) & 63;
    indexR[hashIdx] = r;
    indexG[hashIdx] = g;
    indexB[hashIdx] = b;
    indexA[hashIdx] = a;

    pixels[pxOut++] = r;
    pixels[pxOut++] = g;
    pixels[pxOut++] = b;
    pixels[pxOut++] = a;
  }

  if (pxOut !== outEnd) {
    throw new Error(
      `GM-QOI decoded pixel count mismatch: got ${pxOut / 4}, expected ${totalPixels}`,
    );
  }

  return { width, height, pixels };
}

/**
 * Encodes an RGBA8888 pixel buffer into GameMaker QOI v0 (`fioq`) format.
 * Uses all 7 GM-QOI opcodes (`INDEX64`, `RUN8`, `RUN16`, `DIFF8`, `DIFF16`, `DIFF24`, `COLOR`).
 */
export function encodeGmQoi(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const totalPixels = width * height;
  if (pixels.length !== totalPixels * 4) {
    throw new Error(`Expected ${totalPixels * 4} RGBA bytes, got ${pixels.length}`);
  }

  const out = new Uint8Array(12 + totalPixels * 5 + 16);
  out[0] = 0x66; // 'f'
  out[1] = 0x69; // 'i'
  out[2] = 0x6f; // 'o'
  out[3] = 0x71; // 'q'
  writeU16LE(out, 4, width);
  writeU16LE(out, 6, height);

  const indexR = new Uint8Array(64);
  const indexG = new Uint8Array(64);
  const indexB = new Uint8Array(64);
  const indexA = new Uint8Array(64);

  let pr = 0;
  let pg = 0;
  let pb = 0;
  let pa = 255;

  let pos = 12;
  let run = 0;

  const flushRun = (): void => {
    while (run > 0) {
      if (run <= 32) {
        out[pos++] = 0x40 | (run - 1);
        run = 0;
      } else {
        const chunk = Math.min(run, 8224); // max RUN16 = 0x1fff + 33 = 8224
        const enc = chunk - 33;
        out[pos++] = 0x60 | ((enc >>> 8) & 0x1f);
        out[pos++] = enc & 0xff;
        run -= chunk;
      }
    }
  };

  const toSignedByteDelta = (curr: number, prev: number): number => {
    let d = (curr - prev) & 0xff;
    if (d >= 128) d -= 256;
    return d;
  };

  for (let i = 0; i < totalPixels; i++) {
    const off = i * 4;
    const r = pixels[off];
    const g = pixels[off + 1];
    const b = pixels[off + 2];
    const a = pixels[off + 3];

    if (r === pr && g === pg && b === pb && a === pa) {
      run += 1;
      if (run === 8224 || i === totalPixels - 1) {
        flushRun();
      }
      continue;
    }

    if (run > 0) {
      flushRun();
    }

    const hashIdx = (r ^ g ^ b ^ a) & 63;
    if (
      indexR[hashIdx] === r &&
      indexG[hashIdx] === g &&
      indexB[hashIdx] === b &&
      indexA[hashIdx] === a
    ) {
      out[pos++] = hashIdx;
    } else {
      indexR[hashIdx] = r;
      indexG[hashIdx] = g;
      indexB[hashIdx] = b;
      indexA[hashIdx] = a;

      const dr = toSignedByteDelta(r, pr);
      const dg = toSignedByteDelta(g, pg);
      const db = toSignedByteDelta(b, pb);
      const da = toSignedByteDelta(a, pa);

      if (da === 0 && dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
        out[pos++] = 0x80 | ((dr & 3) << 4) | ((dg & 3) << 2) | (db & 3);
      } else if (da === 0 && dr >= -16 && dr <= 15 && dg >= -8 && dg <= 7 && db >= -8 && db <= 7) {
        out[pos++] = 0xc0 | (dr & 0x1f);
        out[pos++] = ((dg & 0x0f) << 4) | (db & 0x0f);
      } else if (
        dr >= -16 &&
        dr <= 15 &&
        dg >= -16 &&
        dg <= 15 &&
        db >= -16 &&
        db <= 15 &&
        da >= -16 &&
        da <= 15
      ) {
        const packed =
          ((dr & 0x1f) << 15) | ((dg & 0x1f) << 10) | ((db & 0x1f) << 5) | (da & 0x1f);
        out[pos++] = 0xe0 | ((packed >>> 16) & 0x0f);
        out[pos++] = (packed >>> 8) & 0xff;
        out[pos++] = packed & 0xff;
      } else {
        let mask = 0xf0;
        if (r !== pr) mask |= 8;
        if (g !== pg) mask |= 4;
        if (b !== pb) mask |= 2;
        if (a !== pa) mask |= 1;
        out[pos++] = mask;
        if ((mask & 8) !== 0) out[pos++] = r;
        if ((mask & 4) !== 0) out[pos++] = g;
        if ((mask & 2) !== 0) out[pos++] = b;
        if ((mask & 1) !== 0) out[pos++] = a;
      }
    }

    pr = r;
    pg = g;
    pb = b;
    pa = a;
  }

  writeU32LE(out, 8, pos - 12);
  return out.slice(0, pos);
}

/**
 * Decodes a GameMaker `2zoq` texture blob (BZip2-compressed GM-QOI `fioq` texture):
 * - bytes 0..3: ASCII `'2zoq'`
 * - bytes 4..5: `uint16LE width`
 * - bytes 6..7: `uint16LE height`
 * - bytes 8.. : standard BZip2 stream decompressing to an `'fioq'` buffer
 */
export function decode2zoqTexture(buf: Uint8Array): DecodedImage {
  if (buf.length < 18) {
    throw new Error('2zoq texture buffer too short');
  }
  if (buf[0] !== 0x32 || buf[1] !== 0x7a || buf[2] !== 0x6f || buf[3] !== 0x71) {
    throw new Error('Invalid 2zoq magic header (expected "2zoq")');
  }

  const headerWidth = readU16LE(buf, 4);
  const headerHeight = readU16LE(buf, 6);
  const fioqBuffer = decompressBzip2(buf.subarray(8));
  const decoded = decodeGmQoi(fioqBuffer);

  if (decoded.width !== headerWidth || decoded.height !== headerHeight) {
    throw new Error(
      `2zoq header dimensions (${headerWidth}x${headerHeight}) do not match fioq payload (${decoded.width}x${decoded.height})`,
    );
  }

  return decoded;
}

// ============================================================================
// 3. PURE-TS LOSSLESS RGBA PNG ENCODER (Works in Browser & Node)
// ============================================================================

function computePngCrc32(data: Uint8Array, offset: number, length: number): number {
  let crc = 0xffffffff;
  const end = offset + length;
  for (let i = offset; i < end; i++) {
    crc = (PNG_CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (~crc) >>> 0;
}

function computeAdler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < data.length; i++) {
    a += data[i];
    if (a >= MOD) a -= MOD;
    b += a;
    if (b >= MOD) b -= MOD;
  }
  return (((b & 0xffff) << 16) | (a & 0xffff)) >>> 0;
}

/** Wraps raw bytes in a valid RFC 1950 zlib stream using uncompressed DEFLATE stored blocks. */
function wrapZlibStored(raw: Uint8Array): Uint8Array {
  const MAX_BLOCK = 65535;
  const blockCount = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  const totalLen = 2 + raw.length + blockCount * 5 + 4;
  const out = new Uint8Array(totalLen);

  // Zlib header: CMF=0x78 (DEFLATE, 32K window), FLG=0x01 (check bits valid)
  out[0] = 0x78;
  out[1] = 0x01;

  let srcPos = 0;
  let dstPos = 2;
  for (let b = 0; b < blockCount; b++) {
    const remaining = raw.length - srcPos;
    const blockLen = Math.min(MAX_BLOCK, remaining);
    const isFinal = b === blockCount - 1 ? 1 : 0;
    out[dstPos++] = isFinal; // BFINAL | BTYPE=00 (stored)
    out[dstPos++] = blockLen & 0xff;
    out[dstPos++] = (blockLen >>> 8) & 0xff;
    const nlen = (~blockLen) & 0xffff;
    out[dstPos++] = nlen & 0xff;
    out[dstPos++] = (nlen >>> 8) & 0xff;
    if (blockLen > 0) {
      out.set(raw.subarray(srcPos, srcPos + blockLen), dstPos);
      srcPos += blockLen;
      dstPos += blockLen;
    }
  }

  writeU32BE(out, dstPos, computeAdler32(raw));
  return out;
}

function makePngChunk(type: string, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + payload.length);
  writeU32BE(chunk, 0, payload.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(payload, 8);
  const crc = computePngCrc32(chunk, 4, 4 + payload.length);
  writeU32BE(chunk, 8 + payload.length, crc);
  return chunk;
}

/**
 * Encodes an RGBA8888 pixel buffer into a lossless standard PNG Uint8Array.
 * Defaults to pure-TS stored-deflate zlib framing (zero external deps, browser-safe).
 * Node callers may pass `(raw) => new Uint8Array(zlib.deflateSync(raw))` for compact PNG output.
 */
export function encodeRgbaToPng(
  pixels: Uint8Array,
  width: number,
  height: number,
  compressZlib?: (rawScanlines: Uint8Array) => Uint8Array,
): Uint8Array {
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
  }
  if (pixels.length !== width * height * 4) {
    throw new Error(`Expected ${width * height * 4} RGBA bytes, got ${pixels.length}`);
  }

  const stride = width * 4;
  const rawScanlines = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const dstOff = y * (stride + 1);
    rawScanlines[dstOff] = 0; // PNG filter type 0 (None)
    rawScanlines.set(pixels.subarray(y * stride, (y + 1) * stride), dstOff + 1);
  }

  const compressed = compressZlib ? compressZlib(rawScanlines) : wrapZlibStored(rawScanlines);

  const ihdrPayload = new Uint8Array(13);
  writeU32BE(ihdrPayload, 0, width);
  writeU32BE(ihdrPayload, 4, height);
  ihdrPayload[8] = 8; // bit depth = 8
  ihdrPayload[9] = 6; // color type = 6 (RGBA)
  ihdrPayload[10] = 0; // compression = deflate
  ihdrPayload[11] = 0; // filter = adaptive
  ihdrPayload[12] = 0; // interlace = none

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = makePngChunk('IHDR', ihdrPayload);
  const idat = makePngChunk('IDAT', compressed);
  const iend = makePngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdr, offset);
  offset += ihdr.length;
  png.set(idat, offset);
  offset += idat.length;
  png.set(iend, offset);

  return png;
}
