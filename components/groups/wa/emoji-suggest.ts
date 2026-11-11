/**
 * Emojis por nombre mientras escribís (":che" → 👨‍🍳 🍒 🧀), como WhatsApp y
 * Slack. Puro: lo usa useEmojiSuggest (composer de Lines e Inbox) y se prueba
 * en tests/unit/emoji-suggest.test.ts.
 */

/** Lo que se está escribiendo después de ":" (dos letras o más, pegado al cursor). null: no hay búsqueda. */
export function emojiQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  // Después de un espacio, un paréntesis o al principio: "10:30" o "http://" no cuentan.
  const m = /(?:^|[\s(])(:([\p{L}\p{N}_+-]{2,30}))$/u.exec(before);
  if (!m) return null;
  return { start: before.length - m[1].length, query: m[2] };
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Los emojis que coinciden, mejores primero: una palabra del nombre que
 * empieza con lo escrito, después los alias en español o portugués, después
 * lo escrito en medio de una palabra. Los recientes suben dentro de cada
 * grupo.
 */
export function rankEmoji(all: ReadonlyArray<readonly [string, string]>, query: string, aliases: Record<string, string>, recent: readonly string[] = [], limit = 8): Array<{ char: string; name: string }> {
  const q = fold(query.replace(/[_-]+/g, ' ').trim());
  if (q.length < 2) return [];
  const aliasWords = new Set<string>();
  for (const [k, v] of Object.entries(aliases)) if (fold(k).startsWith(q)) for (const w of v.split(/\s+/)) aliasWords.add(w);
  const recentAt = new Map(recent.map((c, i) => [c, i]));
  const scored: Array<{ char: string; name: string; score: number }> = [];
  const seen = new Set<string>();
  for (const [char, name] of all) {
    if (seen.has(char)) continue;
    const words = name.toLowerCase().split(/[\s:,-]+/);
    let score = -1;
    const wi = words.findIndex((w) => w.startsWith(q));
    if (q.includes(' ') ? name.toLowerCase().startsWith(q) || name.toLowerCase().includes(` ${q}`) : wi >= 0) score = 0 + Math.max(0, wi) * 0.01;
    else if (aliasWords.size && words.some((w) => aliasWords.has(w))) score = 1;
    else if (q.length >= 3 && name.toLowerCase().includes(q)) score = 2;
    if (score < 0) continue;
    const r = recentAt.get(char);
    if (r !== undefined) score -= 0.5 - r * 0.001;
    // Los nombres cortos (el emoji "base") antes que las variantes largas.
    score += name.length * 0.0001;
    seen.add(char);
    scored.push({ char, name, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ char, name }) => ({ char, name }));
}
