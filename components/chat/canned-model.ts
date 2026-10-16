/** Acciones de una respuesta guardada (lib/chat-inbox.ts → CannedActions). */
export interface CannedActions {
  status?: 'open' | 'pending' | 'resolved';
  assignTo?: string;
  addTags?: string[];
  snoozeHours?: number;
}

/** Formulario: '' = sin acción. assignTo: 'me', '__none' (desasignar) o el id de un agente. */
export interface CannedForm {
  shortcut: string;
  /** true cuando la persona escribió el atajo a mano: deja de derivarse del título. */
  shortcutTouched: boolean;
  title: string;
  body: string;
  status: '' | 'open' | 'pending' | 'resolved';
  assignTo: string;
  tags: string;
  snoozeHours: string;
}

export function emptyCannedForm(): CannedForm {
  return { shortcut: '', shortcutTouched: false, title: '', body: '', status: '', assignTo: '', tags: '', snoozeHours: '' };
}

export function parseCannedActions(raw: string | undefined | null): CannedActions {
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    return v && typeof v === 'object' ? (v as CannedActions) : {};
  } catch {
    return {};
  }
}

export function cannedActionsFromForm(form: CannedForm): CannedActions {
  const out: CannedActions = {};
  if (form.status) out.status = form.status;
  if (form.assignTo) out.assignTo = form.assignTo === '__none' ? '' : form.assignTo;
  const tags = form.tags
    .split(/[\s,]+/)
    .map((x) => x.replace(/^#/, '').trim())
    .filter(Boolean);
  if (tags.length) out.addTags = tags;
  if (form.snoozeHours) out.snoozeHours = Number(form.snoozeHours);
  return out;
}

export function countCannedActions(a: CannedActions): number {
  return (a.status ? 1 : 0) + (a.assignTo !== undefined ? 1 : 0) + (a.addTags?.length ? 1 : 0) + (a.snoozeHours ? 1 : 0);
}

/**
 * "/Saludo inicial" → "/saludo-inicial": el atajo siempre arranca con "/",
 * en minúsculas, sin acentos ni espacios. Sirve para derivarlo del título.
 */
export function normalizeShortcut(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 59);
  return slug ? `/${slug}` : '';
}

/** Lo que se guarda: el atajo derivado del título si no se escribió uno, y el título nunca vacío. */
export function cannedPayload(form: CannedForm) {
  const shortcut = normalizeShortcut(form.shortcutTouched ? form.shortcut : form.shortcut || form.title);
  const title = form.title.trim() || shortcut.replace(/^\//, '');
  return { shortcut, title, body: form.body.trim(), actions: cannedActionsFromForm(form) };
}
