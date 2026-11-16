/**
 * Avisos de CSP (report-uri: application/csp-report; Reporting API:
 * application/reports+json) → líneas cortas para el log. Solo directiva, el
 * origen de lo bloqueado y el path de la página: ni query, ni hash, ni el
 * fragmento de código (pueden llevar datos de la persona).
 */
type Raw = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** "inline", "eval", el origen de una URL o el esquema (data:, blob:). */
function blockedOf(v: string): string {
  if (!v) return '-';
  if (/^(inline|eval|wasm-eval|trusted-types-[a-z-]+)$/.test(v)) return v;
  try {
    const u = new URL(v);
    return u.origin === 'null' ? `${u.protocol}` : u.origin;
  } catch {
    return v.replace(/[^a-z:-]/gi, '').slice(0, 20) || '-';
  }
}

function pathOf(v: string): string {
  try {
    return new URL(v).pathname.slice(0, 200);
  } catch {
    return '-';
  }
}

function lineOf(r: Raw): string | null {
  const directive = str(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive']).split(' ')[0];
  if (!directive) return null;
  const blocked = blockedOf(str(r['blocked-uri'] ?? r.blockedURL));
  const page = pathOf(str(r['document-uri'] ?? r.documentURL));
  const disposition = str(r.disposition) || 'report';
  return `${disposition} ${directive.replace(/[^a-z-]/gi, '').slice(0, 40)} ${blocked} ${page}`;
}

export function cspReportLines(text: string): string[] {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return [];
  }
  const out: string[] = [];
  const items = Array.isArray(body) ? body.slice(0, 20) : [body];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Raw;
    // report-uri: { "csp-report": {...} }; Reporting API: { type: "csp-violation", body: {...} }.
    const r = (it['csp-report'] ?? (it.type === 'csp-violation' ? it.body : null)) as Raw | null;
    if (!r || typeof r !== 'object') continue;
    const line = lineOf(r);
    if (line) out.push(line);
  }
  return out;
}
