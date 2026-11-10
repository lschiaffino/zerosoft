import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PART_SIZE, planParts, readPart } from '../lib/parts.js';
import { HttpError, backoffDelay, isRetryable, withRetry } from '../lib/retry.js';
import { CaptionLog, coalesceSpeakers } from '../lib/timeline.js';

test('planParts: 4 MB exact parts, last smaller', () => {
  assert.equal(PART_SIZE, 4194304);
  assert.deepEqual(planParts(0), []);
  assert.deepEqual(planParts(10), [{ n: 0, start: 0, length: 10 }]);
  assert.deepEqual(planParts(PART_SIZE), [{ n: 0, start: 0, length: PART_SIZE }]);
  const p = planParts(2 * PART_SIZE + 5);
  assert.deepEqual(
    p.map((x) => x.length),
    [PART_SIZE, PART_SIZE, 5],
  );
  assert.deepEqual(
    p.map((x) => x.n),
    [0, 1, 2],
  );
  assert.equal(p[2].start, 2 * PART_SIZE);
  assert.throws(() => planParts(-1));
});

test('readPart reassembles the file byte for byte', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zs-parts-'));
  try {
    const data = Buffer.alloc(25_000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) % 251;
    const file = path.join(dir, 'f.bin');
    await fsp.writeFile(file, data);
    const fh = await fsp.open(file, 'r');
    const bufs = [];
    for (const part of planParts(data.length, 7000)) bufs.push(await readPart(fh, part));
    await fh.close();
    assert.deepEqual(
      bufs.map((b) => b.length),
      [7000, 7000, 7000, 4000],
    );
    assert.ok(Buffer.concat(bufs).equals(data));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('coalesceSpeakers merges close samples and splits on gaps', () => {
  const s = [
    { name: 'Ana', t: 1000 },
    { name: 'Ana', t: 1500 },
    { name: 'Ana', t: 2500 },
    { name: 'Bruno', t: 3000 },
    { name: 'Bruno', t: 3500 },
    { name: 'Ana', t: 9000 },
    { name: ' ', t: 9100 },
    { name: 'Ana', t: NaN },
  ];
  assert.deepEqual(coalesceSpeakers(s, { gapMs: 2000, padMs: 500 }), [
    { name: 'Ana', startMs: 1000, endMs: 3000 },
    { name: 'Bruno', startMs: 3000, endMs: 4000 },
    { name: 'Ana', startMs: 9000, endMs: 9500 },
  ]);
});

test('coalesceSpeakers handles unsorted input and overlap', () => {
  const s = [
    { name: 'B', t: 1200 },
    { name: 'A', t: 1000 },
    { name: 'A', t: 1400 },
    { name: 'B', t: -50 },
  ];
  const out = coalesceSpeakers(s, { gapMs: 1500, padMs: 0 });
  assert.deepEqual(out, [
    { name: 'B', startMs: 0, endMs: 1200 },
    { name: 'A', startMs: 1000, endMs: 1400 },
  ]);
  assert.deepEqual(coalesceSpeakers([]), []);
});

test('CaptionLog keeps the final text of growing captions', () => {
  const c = new CaptionLog();
  c.add({ id: 1, speaker: 'Ana', text: 'Hola', t: 100 });
  c.add({ id: 1, speaker: 'Ana', text: 'Hola, ¿me escuchan?', t: 900 });
  c.add({ id: 2, speaker: 'Bruno', text: 'Sí', t: 2000 });
  c.add({ id: 3, speaker: 'Bruno', text: 'Sí, perfecto', t: 2100 }); // re-rendered block
  c.add({ id: 4, speaker: 'Ana', text: '', t: 3000 });
  assert.deepEqual(c.list(), [
    { speaker: 'Ana', text: 'Hola, ¿me escuchan?', startMs: 100 },
    { speaker: 'Bruno', text: 'Sí, perfecto', startMs: 2000 },
  ]);
});

test('backoffDelay grows exponentially with a cap', () => {
  const r = () => 1;
  assert.equal(backoffDelay(0, { baseMs: 1000, random: r }), 1000);
  assert.equal(backoffDelay(1, { baseMs: 1000, random: r }), 2000);
  assert.equal(backoffDelay(3, { baseMs: 1000, random: r }), 8000);
  assert.equal(backoffDelay(10, { baseMs: 1000, maxMs: 30000, random: r }), 30000);
  assert.equal(backoffDelay(0, { baseMs: 1000, random: () => 0 }), 750);
});

test('isRetryable: 5xx and network yes, 4xx no', () => {
  assert.equal(isRetryable(new HttpError(500)), true);
  assert.equal(isRetryable(new HttpError(503)), true);
  assert.equal(isRetryable(new HttpError(400)), false);
  assert.equal(isRetryable(new HttpError(404)), false);
  assert.equal(isRetryable(new TypeError('fetch failed')), true);
});

test('withRetry retries 5xx up to the limit, stops on 4xx', async () => {
  const sleeps = [];
  const sleep = async (/** @type {number} */ ms) => void sleeps.push(ms);
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new HttpError(502);
      },
      { retries: 5, baseMs: 10, sleep, random: () => 1 },
    ),
    /http_502/,
  );
  assert.equal(calls, 6);
  assert.deepEqual(sleeps, [10, 20, 40, 80, 160]);

  calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new HttpError(409);
      },
      { sleep },
    ),
  );
  assert.equal(calls, 1);

  calls = 0;
  const v = await withRetry(
    async () => {
      if (++calls < 3) throw new TypeError('network');
      return 'ok';
    },
    { sleep },
  );
  assert.equal(v, 'ok');
  assert.equal(calls, 3);
});
