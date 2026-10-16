/**
 * Etiquetas traducidas para las analytics de Link: los clicks guardan valores
 * crudos (desktop, unknown, rule:2, ab:B, app:ios, códigos de país) y acá se
 * pasan a texto del locale. Módulo puro: los mensajes llegan ya traducidos.
 */

export interface BreakdownMessages {
  direct: string;
  other: string;
  unknown: string;
  variantDefault: string;
  device: Record<'desktop' | 'mobile' | 'tablet', string>;
  rule: (n: string) => string;
  ab: (variant: string) => string;
  app: (os: string) => string;
}

export interface BreakdownLabelers {
  /** referrer, navegador, sistema: solo los valores especiales. */
  plain: (name: string) => string;
  country: (name: string) => string;
  device: (name: string) => string;
  variant: (name: string) => string;
}

const APP_OS: Record<string, string> = { ios: 'iOS', android: 'Android' };

export function breakdownLabelers(locale: string, m: BreakdownMessages): BreakdownLabelers {
  let regions: Intl.DisplayNames | null = null;
  try {
    regions = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    regions = null;
  }
  // El navegador/sistema desconocido se guarda como 'Other' (ua-parser): también es especial.
  const special = (n: string): string | null => {
    const k = n.toLowerCase();
    return k === 'direct' ? m.direct : k === 'other' ? m.other : k === 'unknown' ? m.unknown : null;
  };

  return {
    plain: (n) => special(n) ?? n,
    country: (n) => {
      const s = special(n);
      if (s) return s;
      if (!regions || !/^[A-Z]{2}$/i.test(n)) return n;
      try {
        return regions.of(n.toUpperCase()) ?? n;
      } catch {
        return n;
      }
    },
    device: (n) => special(n) ?? (n in m.device ? m.device[n as keyof BreakdownMessages['device']] : n),
    variant: (n) => {
      if (n === 'default') return m.variantDefault;
      const s = special(n);
      if (s) return s;
      const [kind, value] = n.split(':', 2);
      if (!value) return n;
      if (kind === 'rule') return m.rule(value);
      if (kind === 'ab') return m.ab(value);
      if (kind === 'app') return m.app(APP_OS[value] ?? value);
      return n;
    },
  };
}
