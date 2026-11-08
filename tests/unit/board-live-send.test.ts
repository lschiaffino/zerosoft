import { describe, expect, it } from 'vitest';
import { LIVE_BULK_MAX, countChanged, liveBackoffMs, markReceived, takeChangedBytes } from '@/lib/board-collab';

describe('live sends on big boards', () => {
  const scene = Array.from({ length: 1200 }, (_, i) => ({ id: `e${i}`, version: 1 }));

  it('nothing counts as unsent right after open (seeded from the loaded scene)', () => {
    const sent = new Map<string, number>();
    markReceived(scene, sent);
    expect(countChanged(scene, sent)).toBe(0);
    expect(takeChangedBytes(scene, sent).elements).toHaveLength(0);
  });

  it('a re-measure that bumps every version is seen as bulk and left to the save', () => {
    const sent = new Map<string, number>();
    markReceived(scene, sent);
    const bumped = scene.map((e) => ({ ...e, version: 2 }));
    expect(countChanged(bumped, sent, LIVE_BULK_MAX + 1)).toBe(LIVE_BULK_MAX + 1);
  });

  it('backs off exponentially with jitter, capped at 30 s', () => {
    expect(liveBackoffMs(1, () => 0)).toBe(1000);
    expect(liveBackoffMs(2, () => 0)).toBe(2000);
    expect(liveBackoffMs(4, () => 0)).toBe(8000);
    expect(liveBackoffMs(10, () => 0)).toBe(30_000);
    expect(liveBackoffMs(1, () => 1)).toBe(1300);
  });
});
