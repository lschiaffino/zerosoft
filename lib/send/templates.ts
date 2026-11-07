/** Send: plantillas de Sign que sirven de acuerdo: con documento y una sola persona que firma. */
import { listTemplates } from '../sign/templates';
import type { SignActor } from '../sign/types';
import { SendError, type SendActor } from './types';

export async function sendTemplates(actor: SendActor): Promise<Array<{ id: string; name: string }>> {
  const rows = await listTemplates(actor as SignActor).catch(() => []);
  return rows
    .filter((t) => {
      if (!t.document_ref) return false;
      try {
        const roles = JSON.parse(t.roles || '[]') as Array<{ role: string }>;
        return roles.length === 1 && roles[0].role !== 'cc';
      } catch {
        return false;
      }
    })
    .map((t) => ({ id: t.id, name: t.name }));
}

/** El acuerdo de un link: una plantilla que quien arma el link ve y puede usar. Sin Sign, ninguna. */
export async function assertNdaTemplate(actor: SendActor, canUseSign: boolean, id: string | null | undefined, current: string | null = null): Promise<void> {
  if (!id || id === current) return;
  const ok = canUseSign && (await sendTemplates(actor)).some((t) => t.id === id);
  if (!ok) throw new SendError('nda_template_invalid', 400);
}
