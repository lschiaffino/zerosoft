'use client';

import { useEffect, useState } from 'react';
import { hasRoutableHost } from '@/lib/utils';
import { UTM_FIELDS, UTM_KEYS, type UtmField } from '@/lib/link-url';

export const SLUG_RE = /^[A-Za-z0-9_-]{2,32}$/;

export type SlugState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'reserved';

/** URL final con los UTM aplicados (null si no parsea o el host no tiene TLD). */
export function composeUtmUrl(url: string, utm: Partial<Record<UtmField, string>> = {}): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (!hasRoutableHost(u.hostname)) return null;
    for (const field of UTM_FIELDS) {
      const value = utm[field]?.trim();
      if (value) u.searchParams.set(UTM_KEYS[field], value);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/** Disponibilidad del slug contra el servidor, con debounce. Vacío = se genera solo. */
export function useSlugCheck(slug: string, domainId: string, delay = 350): SlugState {
  const [state, setState] = useState<SlugState>('idle');

  useEffect(() => {
    const value = slug.trim();
    if (!value) {
      setState('idle');
      return;
    }
    if (!SLUG_RE.test(value)) {
      setState('invalid');
      return;
    }
    setState('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/links/check-slug?slug=${encodeURIComponent(value)}${domainId ? `&domainId=${encodeURIComponent(domainId)}` : ''}`,
        );
        const data = (await res.json()) as { available: boolean; valid: boolean };
        // El formato ya se validó acá: si el server dice inválido es una palabra reservada.
        setState(!data.valid ? 'reserved' : data.available ? 'available' : 'taken');
      } catch {
        setState('idle');
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [slug, domainId, delay]);

  return state;
}
