// Speaker timeline and caption bookkeeping.

/**
 * Coalesces point samples "name was speaking at t" into segments.
 * Consecutive samples of the same name closer than gapMs extend one segment.
 * Each segment ends padMs after its last sample.
 * @param {{ name: string, t: number }[]} samples t in ms since recording start
 * @param {{ gapMs?: number, padMs?: number, maxSegments?: number }} [opts]
 * @returns {{ name: string, startMs: number, endMs: number }[]}
 */
export function coalesceSpeakers(samples, opts = {}) {
  const gapMs = opts.gapMs ?? 2000;
  const padMs = opts.padMs ?? 500;
  const maxSegments = opts.maxSegments ?? 20000;
  const sorted = samples
    .filter((s) => s && typeof s.name === 'string' && s.name.trim() && Number.isFinite(s.t))
    .map((s) => ({ name: s.name.trim().slice(0, 120), t: Math.max(0, Math.round(s.t)) }))
    .sort((a, b) => a.t - b.t);
  /** @type {Map<string, { name: string, startMs: number, last: number }>} */
  const open = new Map();
  /** @type {{ name: string, startMs: number, endMs: number }[]} */
  const done = [];
  for (const s of sorted) {
    const cur = open.get(s.name);
    if (cur && s.t - cur.last <= gapMs) {
      cur.last = s.t;
    } else {
      if (cur) done.push({ name: cur.name, startMs: cur.startMs, endMs: cur.last + padMs });
      open.set(s.name, { name: s.name, startMs: s.t, last: s.t });
    }
  }
  for (const cur of open.values()) done.push({ name: cur.name, startMs: cur.startMs, endMs: cur.last + padMs });
  done.sort((a, b) => a.startMs - b.startMs || a.name.localeCompare(b.name));
  return done.slice(0, maxSegments);
}

/**
 * Accumulates caption updates (Meet grows a caption block in place).
 */
export class CaptionLog {
  constructor(maxEntries = 10000) {
    /** @type {Map<string, { speaker: string, text: string, startMs: number }>} */
    this.byId = new Map();
    this.maxEntries = maxEntries;
  }

  /**
   * @param {{ id: string|number, speaker: string, text: string, t: number }} u t in ms since recording start
   */
  add(u) {
    if (!u || typeof u.text !== 'string' || typeof u.speaker !== 'string') return;
    const key = String(u.id);
    const text = u.text.trim().slice(0, 2000);
    const speaker = u.speaker.trim().slice(0, 120);
    const cur = this.byId.get(key);
    if (cur) {
      cur.text = text;
      return;
    }
    if (this.byId.size >= this.maxEntries) return;
    this.byId.set(key, { speaker, text, startMs: Math.max(0, Math.round(u.t)) });
  }

  /** @returns {{ speaker: string, text: string, startMs: number }[]} */
  list() {
    const all = [...this.byId.values()].filter((c) => c.text).sort((a, b) => a.startMs - b.startMs);
    /** @type {{ speaker: string, text: string, startMs: number }[]} */
    const out = [];
    for (const c of all) {
      const prev = out[out.length - 1];
      // Re-rendered blocks repeat the same text: keep the longer one.
      if (prev && prev.speaker === c.speaker && (c.text.startsWith(prev.text) || prev.text.startsWith(c.text))) {
        if (c.text.length > prev.text.length) prev.text = c.text;
        continue;
      }
      out.push({ ...c });
    }
    return out;
  }
}
