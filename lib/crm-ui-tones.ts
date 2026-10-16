/** Tono del .badge para cada estado, igual en listas y detalles del CRM. */
export const QUOTE_TONE: Record<string, string> = {
  draft: '',
  sent: 'badge-info',
  accepted: 'badge-ok',
  declined: 'badge-bad',
  expired: 'badge-outline',
};

export const FORM_TONE: Record<string, string> = { active: 'badge-ok', paused: 'badge-warn', archived: 'badge-outline' };

export function badgeClass(tones: Record<string, string>, status: string): string {
  return `badge ${tones[status] ?? ''}`.trim();
}
