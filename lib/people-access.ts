/**
 * People: quién ve y quién hace qué. Funciones puras (sin base): las prueba
 * tests/unit/people-access.test.ts y las usan las rutas, la página, ⌘K, el
 * asistente, los exports y la API v1. Un solo lugar decide; nadie filtra a mano.
 *
 * Roles dentro de People, encima de los del workspace:
 * - HR: owner y admins del workspace, más quien HR marque como HR admin.
 * - Manager: tiene reportes (directos o indirectos) por los links de manager.
 * - Employee: todo miembro con la app.
 */

export type VisibilityLevel = 'everyone' | 'managers' | 'hr';

/** Campos del directorio que el workspace puede restringir (Ajustes › Visibilidad). */
export const CONFIGURABLE_FIELDS = ['phone', 'location', 'startDate', 'employmentType', 'birthday'] as const;
export type ConfigurableField = (typeof CONFIGURABLE_FIELDS)[number];

export type VisibilitySettings = Partial<Record<ConfigurableField, VisibilityLevel>>;

export const DEFAULT_VISIBILITY: Record<ConfigurableField, VisibilityLevel> = {
  phone: 'everyone',
  location: 'everyone',
  startDate: 'everyone',
  employmentType: 'everyone',
  birthday: 'everyone',
};

/**
 * Grupos de datos sensibles. Nunca salen a quien no corresponde: ni en la
 * página, ni en la API, ni en ⌘K, ni en el asistente, ni en avisos o exports.
 * - personal: email personal, dirección, documento, fecha de nacimiento completa, contactos de emergencia.
 * - compensation: sueldo e historial (HR y la persona; el manager no).
 * - performance: evaluaciones recibidas y objetivos (HR, la persona y su cadena de managers).
 * - timeoff: saldos, tipos e historial de licencias (HR, la persona y su cadena).
 * - exit: entrevista de salida (solo HR).
 */
export type SensitiveGroup = 'personal' | 'compensation' | 'performance' | 'timeoff' | 'exit';

export interface PeopleViewer {
  /** Persona real (users.id). */
  personId: string;
  /** Su ficha en People (null si todavía no tiene). */
  employeeId: string | null;
  /** HR admin (owner, admin del workspace o marcado en People). */
  hr: boolean;
  /** Fichas que le reportan, directa o indirectamente. */
  reports: ReadonlySet<string>;
}

export function isSelf(viewer: PeopleViewer, employeeId: string): boolean {
  return viewer.employeeId != null && viewer.employeeId === employeeId;
}

export function isManagerOf(viewer: PeopleViewer, employeeId: string): boolean {
  return viewer.reports.has(employeeId) && !isSelf(viewer, employeeId);
}

/** ¿Ve el grupo sensible de esta ficha? */
export function canSeeSensitive(viewer: PeopleViewer, employeeId: string, group: SensitiveGroup): boolean {
  if (viewer.hr) return true;
  const self = isSelf(viewer, employeeId);
  switch (group) {
    case 'personal':
    case 'compensation':
      return self;
    case 'performance':
    case 'timeoff':
      return self || isManagerOf(viewer, employeeId);
    case 'exit':
      return false;
  }
}

/** ¿Ve un campo configurable del directorio? HR y la propia persona siempre. */
export function canSeeField(viewer: PeopleViewer, employeeId: string, field: ConfigurableField, settings: VisibilitySettings = {}): boolean {
  if (viewer.hr || isSelf(viewer, employeeId)) return true;
  const level = settings[field] ?? DEFAULT_VISIBILITY[field];
  if (level === 'everyone') return true;
  if (level === 'managers') return isManagerOf(viewer, employeeId);
  return false;
}

/** ¿Ve un campo propio marcado como sensible? (HR y la persona). Los no sensibles los ve todo el workspace. */
export function canSeeCustomField(viewer: PeopleViewer, employeeId: string, sensitive: boolean): boolean {
  if (!sensitive) return true;
  return viewer.hr || isSelf(viewer, employeeId);
}

/** Editar la ficha completa (puesto, manager, fechas, tipo): solo HR. */
export function canEditJob(viewer: PeopleViewer): boolean {
  return viewer.hr;
}

/** Campos que cada persona edita de su propia ficha (autoservicio). */
export const SELF_EDITABLE = ['phone', 'personalEmail', 'address', 'birthDate', 'emergencyContacts', 'pronouns', 'bio', 'photo'] as const;
export type SelfEditable = (typeof SELF_EDITABLE)[number];

export function canEditField(viewer: PeopleViewer, employeeId: string, field: string): boolean {
  if (viewer.hr) return true;
  return isSelf(viewer, employeeId) && (SELF_EDITABLE as readonly string[]).includes(field);
}

/**
 * Aprobar o rechazar un pedido de licencia: HR, o un manager de la cadena de
 * esa persona. Nadie aprueba lo propio, salvo HR sin manager (el owner de un
 * workspace chico no tiene a quién pedirle).
 */
export function canApprove(viewer: PeopleViewer, requestEmployeeId: string, requesterHasManager = true): boolean {
  if (isSelf(viewer, requestEmployeeId)) return viewer.hr && !requesterHasManager;
  if (viewer.hr) return true;
  return isManagerOf(viewer, requestEmployeeId);
}

/** Pedir licencia a nombre de otro: HR. Cada persona pide lo suyo. */
export function canRequestFor(viewer: PeopleViewer, employeeId: string): boolean {
  return viewer.hr || isSelf(viewer, employeeId);
}

/** Notas 1:1: solo las dos personas, ni HR ni la cadena. */
export function canSeeOneOnOne(viewer: PeopleViewer, note: { aId: string; bId: string }): boolean {
  return viewer.employeeId != null && (note.aId === viewer.employeeId || note.bId === viewer.employeeId);
}

/** Documento de una ficha: HR siempre; la persona si se lo compartieron; las políticas generales (sin ficha) todos. */
export function canSeeDocument(viewer: PeopleViewer, doc: { employeeId: string | null; visibility: 'hr' | 'employee' }): boolean {
  if (viewer.hr) return true;
  if (doc.employeeId == null) return doc.visibility === 'employee';
  return doc.visibility === 'employee' && isSelf(viewer, doc.employeeId);
}

/**
 * Cadena de reportes: dado `managerOf` (ficha → su manager), las fichas que
 * le reportan a `root` en cualquier nivel. Corta ciclos.
 */
export function reportsOf(root: string, managerOf: ReadonlyMap<string, string | null>): Set<string> {
  const children = new Map<string, string[]>();
  for (const [id, mgr] of managerOf) {
    if (!mgr) continue;
    const list = children.get(mgr) ?? [];
    list.push(id);
    children.set(mgr, list);
  }
  const out = new Set<string>();
  const stack = [...(children.get(root) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || id === root) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** ¿Poner a `managerId` como manager de `employeeId` armaría un ciclo? */
export function wouldCycle(employeeId: string, managerId: string | null, managerOf: ReadonlyMap<string, string | null>): boolean {
  if (!managerId) return false;
  if (managerId === employeeId) return true;
  return reportsOf(employeeId, managerOf).has(managerId);
}
