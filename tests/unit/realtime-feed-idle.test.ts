import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedFeed } from '@/lib/realtime';

afterEach(() => vi.useRealTimers());

describe('sharedFeed: lee menos cuando está quieto', () => {
  it('lee cada intervalo al principio y cada segundo después de 10 s sin eventos', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const feed = sharedFeed<{ id: number }>(`idle-test-${Math.random()}`, {
      start: async () => 0,
      fetchSince: async () => {
        reads += 1;
        return [];
      },
      intervalMs: 200,
    });
    const off = feed.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(2000);
    const busy = reads;
    expect(busy).toBeGreaterThanOrEqual(8);
    await vi.advanceTimersByTimeAsync(10_000);
    const before = reads;
    await vi.advanceTimersByTimeAsync(5000);
    // Quieto: unas 5 lecturas en 5 s, no 25.
    expect(reads - before).toBeLessThanOrEqual(6);
    off();
    await vi.advanceTimersByTimeAsync(2000);
  });
});
