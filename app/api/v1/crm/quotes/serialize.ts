import type { NextRequest } from 'next/server';
import type { CrmQuoteRow } from '@/lib/db';
import { parseQuoteItems } from '@/lib/crm-products';

/** Origen público para el link /q/<token> (NEXTAUTH_URL o el del request). */
export function publicOrigin(req: NextRequest): string {
  return (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, '');
}

/** Quote para la API v1: items parseados + public_url; sin user_id, token crudo ni hash de IP. */
export function serializeQuote(
  q: CrmQuoteRow & { deal_name?: string | null },
  origin: string,
): Record<string, unknown> {
  const { user_id: _u, signer_ip_hash: _h, token, items, ...rest } = q;
  const { parsed_items: _p, ...clean } = rest as typeof rest & { parsed_items?: unknown };
  return { ...clean, items: parseQuoteItems(items), public_url: `${origin}/q/${token}` };
}
