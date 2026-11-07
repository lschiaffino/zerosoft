/**
 * Send: emails y dominios de las listas de permitidos o bloqueados. Puro, sin Node:
 * lo usan el servidor y el diálogo del link (importar un CSV en el navegador).
 */

export const MAX_ACCESS_ENTRIES = 500;
/** Un CSV más grande que esto no es una lista de emails. */
export const MAX_ACCESS_CSV_BYTES = 1024 * 1024;

const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;

/** Una entrada de la lista: un email, o un dominio ("acme.com", "@acme.com", "*.acme.com"). */
export function normalizeAccessEntry(value: string): string | null {
  const s = value.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@') && !s.startsWith('@')) return normalizeEmail(s);
  const domain = s.replace(/^\*\./, '').replace(/^@/, '');
  return DOMAIN_RE.test(domain) ? domain : null;
}

export function cleanAccessList(values: readonly string[]): { entries: string[]; invalid: string[] } {
  const entries = new Set<string>();
  const invalid: string[] = [];
  for (const raw of values) {
    for (const piece of raw.split(/[\s,;]+/)) {
      if (!piece) continue;
      const e = normalizeAccessEntry(piece);
      if (e) entries.add(e);
      else invalid.push(piece);
    }
  }
  return { entries: [...entries], invalid };
}

/**
 * Emails y dominios de un CSV, en cualquier celda (como DocSend). Las celdas con otra
 * cosa (un nombre, un encabezado, una fecha) se saltean y se cuentan aparte.
 */
export function entriesFromCsv(text: string): { entries: string[]; skipped: number } {
  const entries = new Set<string>();
  let skipped = 0;
  for (const raw of text.replace(/^﻿/, '').split(/[\r\n,;\t]+/)) {
    const cell = raw.trim().replace(/^"(.*)"$/, '$1').replace(/^<(.*)>$/, '$1').trim();
    if (!cell) continue;
    // "Ana Pérez <ana@acme.com>" también vale.
    const inside = /<([^<>\s]+@[^<>\s]+)>/.exec(cell)?.[1];
    const e = normalizeAccessEntry(inside ?? cell);
    if (e) entries.add(e);
    else skipped++;
  }
  return { entries: [...entries], skipped };
}

/** ¿El email coincide con la lista? Un dominio vale para sus subdominios. */
export function matchesAccessList(entries: readonly string[], email: string): boolean {
  const at = email.lastIndexOf('@');
  const domain = email.slice(at + 1);
  return entries.some((e) => (e.includes('@') ? e === email : domain === e || domain.endsWith(`.${e}`)));
}
