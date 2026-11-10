// Splits a file into fixed-size parts (4 MB exact, the last one smaller).
import fsp from 'node:fs/promises';

export const PART_SIZE = 4 * 1024 * 1024;

/**
 * @param {number} size
 * @param {number} [partSize]
 * @returns {{ n: number, start: number, length: number }[]}
 */
export function planParts(size, partSize = PART_SIZE) {
  if (!Number.isInteger(size) || size < 0) throw new RangeError('size');
  if (!Number.isInteger(partSize) || partSize <= 0) throw new RangeError('partSize');
  const out = [];
  for (let start = 0, n = 0; start < size; start += partSize, n++) {
    out.push({ n, start, length: Math.min(partSize, size - start) });
  }
  return out;
}

/**
 * Reads one part of a file.
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {{ start: number, length: number }} part
 */
export async function readPart(fh, part) {
  const buf = Buffer.alloc(part.length);
  let off = 0;
  while (off < part.length) {
    const { bytesRead } = await fh.read(buf, off, part.length - off, part.start + off);
    if (bytesRead === 0) throw new Error('short_read');
    off += bytesRead;
  }
  return buf;
}

/** @param {string} file */
export async function openForParts(file) {
  return fsp.open(file, 'r');
}
