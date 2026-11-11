/**
 * Permisos puntuales que un admin le da a un member, encima de su rol.
 *
 * El rol dice lo general (lib/roles.ts). Una capacidad suma una sola cosa
 * concreta que hoy es de admins, sin hacer admin a la persona: por ejemplo,
 * conectar y administrar sus propios números de WhatsApp en Lines.
 *
 * Reglas:
 * - owner y admin tienen todas las capacidades sin que nadie se las dé.
 * - un member tiene las que figuran en team_members.capabilities, y solo si
 *   además puede usar la app de la capacidad.
 * - un guest no tiene ninguna (aunque quede algo guardado).
 * - solo owner y admins dan o quitan capacidades (members.manage sobre esa persona).
 *
 * Para sumar una capacidad: agregarla a CAPABILITIES con su app, sus textos en
 * messages/<locale>/workspace.json (`caps.<clave con _>.label` y `.help`) y
 * chequearla en el servidor con `can(user, '<clave>')`.
 *
 * Sin dependencias: lo usan también la pantalla de Miembros y los tests.
 */

export const CAPABILITIES = [
  {
    key: 'lines.numbers.manage',
    /** App que tiene que poder usar la persona para que la capacidad valga. */
    app: 'groups',
    /** Dar esta capacidad pide confirmación en la pantalla. */
    confirmGrant: true,
  },
] as const satisfies ReadonlyArray<{ key: string; app: string; confirmGrant: boolean }>;

export type Capability = (typeof CAPABILITIES)[number]['key'];
export type CapabilityDef = (typeof CAPABILITIES)[number];

const KEYS: ReadonlySet<string> = new Set(CAPABILITIES.map((c) => c.key));

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && KEYS.has(value);
}

export function capabilityDef(key: Capability): CapabilityDef {
  return CAPABILITIES.find((c) => c.key === key) as CapabilityDef;
}

/** Clave para los textos (next-intl no acepta puntos dentro de una clave). */
export function capabilityMessageKey(key: Capability): string {
  return key.replace(/\./g, '_');
}

/**
 * Lista limpia desde lo guardado (JSON) o lo que llega en un pedido: solo
 * claves conocidas, sin repetidas, en el orden del registro.
 */
export function parseCapabilities(raw: unknown): Capability[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const set = new Set(value.filter(isCapability));
  return CAPABILITIES.map((c) => c.key).filter((k) => set.has(k));
}

export function serializeCapabilities(caps: readonly string[]): string {
  return JSON.stringify(parseCapabilities([...caps]));
}

/** Quien actúa, como lo ve la regla: rol, apps habilitadas y capacidades guardadas. */
export interface CapabilityActor {
  role: string | null | undefined;
  apps?: unknown;
  caps?: unknown;
}

function appAllowed(apps: unknown, app: string): boolean {
  if (apps == null || apps === '*' || apps === '') return true;
  if (Array.isArray(apps)) return apps.includes('*') || apps.includes(app);
  if (typeof apps === 'string') {
    try {
      return appAllowed(JSON.parse(apps), app);
    } catch {
      return true;
    }
  }
  return false;
}

/** ¿Tiene la capacidad? Owner y admin, siempre; member, si se la dieron y usa la app; guest, nunca. */
export function hasCapability(actor: CapabilityActor, key: Capability): boolean {
  const role = actor.role;
  if (role === 'owner' || role === 'admin') return true;
  if (role !== 'member') return false;
  if (!parseCapabilities(actor.caps).includes(key)) return false;
  return appAllowed(actor.apps, capabilityDef(key).app);
}
