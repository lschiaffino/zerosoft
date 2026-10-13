import { createLink, linkShortUrl, slugExists } from './links';
import { listDomains } from './link-domains';
import { isValidSlug } from './reserved';

/**
 * Importar links desde Bitly: por API (token de acceso de Bitly, trae toda la
 * cuenta) o por el CSV que exporta Bitly. Se conserva el back-half: si el link
 * era de un dominio propio que ya está verificado acá, queda en ese dominio
 * (go.empresa.com/promo sigue funcionando al mover el DNS); si no, va al dominio
 * por defecto con el mismo slug, o uno nuevo si está tomado.
 */

export const MAX_IMPORT = 2000;

export interface ImportItem {
  shortUrl: string;
  url: string;
  title?: string | null;
  tags?: string[];
}

export interface ImportReport {
  imported: number;
  kept: number;
  renamed: Array<{ from: string; to: string }>;
  skipped: Array<{ from: string; reason: string }>;
  truncated: boolean;
}

function splitShort(shortUrl: string): { host: string; backHalf: string } | null {
  const raw = shortUrl.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const backHalf = u.pathname.replace(/^\/+|\/+$/g, '');
    return backHalf && !backHalf.includes('/') ? { host: u.host.toLowerCase(), backHalf } : null;
  } catch {
    return null;
  }
}

export async function importLinks(userId: string, items: ImportItem[]): Promise<ImportReport> {
  const report: ImportReport = { imported: 0, kept: 0, renamed: [], skipped: [], truncated: items.length > MAX_IMPORT };
  const domains = new Map(
    (await listDomains(userId)).filter((d) => d.verified === 1).map((d) => [d.hostname, d.id]),
  );

  for (const item of items.slice(0, MAX_IMPORT)) {
    const parts = splitShort(item.shortUrl);
    const domainId = parts ? (domains.get(parts.host) ?? null) : null;
    const wanted = parts?.backHalf ?? '';
    const keep = wanted && isValidSlug(wanted, Boolean(domainId)) && !(await slugExists(wanted, domainId));

    const res = await createLink(userId, {
      url: item.url,
      slug: keep ? wanted : undefined,
      domainId,
      title: item.title ?? undefined,
      tags: (item.tags ?? []).slice(0, 5),
    });
    if (!res.ok) {
      report.skipped.push({ from: item.shortUrl || item.url, reason: res.code });
      continue;
    }
    report.imported += 1;
    if (keep) report.kept += 1;
    else if (item.shortUrl) report.renamed.push({ from: item.shortUrl, to: linkShortUrl(res.link) });
  }
  return report;
}

// ---------- Bitly API v4 ----------

interface BitlyLink {
  id: string; // "bit.ly/3abcde"
  link: string;
  long_url: string;
  title?: string | null;
  tags?: string[];
  custom_bitlinks?: string[];
}

async function bitly<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url.startsWith('http') ? url : `https://api-ssl.bitly.com/v4${url}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('bitly_unauthorized');
  if (!res.ok) throw new Error(`bitly_${res.status}`);
  return (await res.json()) as T;
}

/** Trae todos los bitlinks de la cuenta (grupo por defecto), paginado. */
export async function fetchBitlyLinks(token: string): Promise<ImportItem[]> {
  const user = await bitly<{ default_group_guid?: string }>(token, '/user');
  if (!user.default_group_guid) throw new Error('bitly_no_group');
  const items: ImportItem[] = [];
  let next: string | null = `/groups/${encodeURIComponent(user.default_group_guid)}/bitlinks?size=100&archived=both`;
  while (next && items.length <= MAX_IMPORT) {
    const page: { links?: BitlyLink[]; pagination?: { next?: string } } = await bitly(token, next);
    for (const l of page.links ?? []) {
      // Un link con back-half propio en un dominio propio: ese es el que importa.
      const preferred = l.custom_bitlinks?.find((c) => !/^https?:\/\/bit\.ly\//i.test(c)) ?? l.custom_bitlinks?.[0];
      items.push({ shortUrl: preferred ?? l.link ?? l.id, url: l.long_url, title: l.title, tags: l.tags });
    }
    next = page.pagination?.next || null;
  }
  return items;
}

// ---------- CSV ----------

/** Parser CSV mínimo (comillas, comas y saltos de línea dentro de comillas). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Detecta las columnas del CSV de Bitly (o de cualquier acortador). */
export function itemsFromCsv(text: string): ImportItem[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const h = header.map((c) => c.trim().toLowerCase());
  const find = (re: RegExp) => h.findIndex((c) => re.test(c));
  const urlCol = find(/long|destination|original|target|^url$/);
  const shortCol = find(/bitlink|short|^link$|custom/);
  const titleCol = find(/title/);
  const tagsCol = find(/tag/);
  if (urlCol === -1) return [];
  return rows
    .map((r) => ({
      url: (r[urlCol] ?? '').trim(),
      shortUrl: shortCol === -1 ? '' : (r[shortCol] ?? '').trim(),
      title: titleCol === -1 ? null : (r[titleCol] ?? '').trim() || null,
      tags:
        tagsCol === -1
          ? []
          : (r[tagsCol] ?? '')
              .split(/[|;,]/)
              .map((t) => t.trim())
              .filter(Boolean),
    }))
    .filter((i) => i.url);
}
