/**
 * Confirmar o cancelar una acción que propuso el asistente. Es lo único que
 * ejecuta escrituras, y solo corre desde POST /api/assistant/actions/<id>
 * (el clic de la persona). Vuelve a mirar los permisos con la sesión del
 * momento del clic: si a la persona le sacaron la app o el rol de admin
 * entre la propuesta y la confirmación, no se ejecuta.
 */
import type { SessionUser } from '../session';
import { actionView, type ActionView } from './engine';
import { redact } from './redact';
import { canUseTool, toolCtx } from './registry';
import { ALL_TOOLS } from './tools';
import { audit, claimAction, finishAction, getAction, type AssistantOwner } from './store';

export type DecideError = 'not_found' | 'not_pending' | 'forbidden' | 'confirm_text_mismatch';

export function confirmTextMatches(expected: string | null, typed: string | null | undefined): boolean {
  if (!expected) return true;
  return (typed ?? '').trim().toLowerCase() === expected.trim().toLowerCase();
}

export async function decideAction(opts: {
  user: SessionUser;
  locale: string;
  id: string;
  decision: 'confirm' | 'cancel';
  typed?: string | null;
}): Promise<{ action: ActionView } | { error: DecideError; action?: ActionView }> {
  const ctx = toolCtx(opts.user, opts.locale);
  const owner: AssistantOwner = { workspaceId: ctx.workspaceId, personId: ctx.personId };
  const action = await getAction(owner, opts.id);
  if (!action) return { error: 'not_found' };
  if (action.status !== 'pending') return { error: 'not_pending', action: actionView(action) };

  if (opts.decision === 'cancel') {
    await claimAction(owner, action.id, 'cancelled');
    await audit({ owner, conversationId: action.conversation_id, tool: action.tool, kind: 'cancel', input: redact(action.input), outcome: 'cancelled' });
    return { action: actionView((await getAction(owner, action.id))!) };
  }

  const def = ALL_TOOLS.find((t) => t.name === action.tool);
  if (!def || def.kind !== 'write' || !canUseTool(opts.user, def)) {
    await audit({ owner, conversationId: action.conversation_id, tool: action.tool, kind: 'denied', input: redact(action.input), outcome: 'forbidden' });
    return { error: 'forbidden', action: actionView(action) };
  }
  if (action.destructive && !confirmTextMatches(action.confirm_text, opts.typed)) {
    return { error: 'confirm_text_mismatch', action: actionView(action) };
  }
  if (!(await claimAction(owner, action.id, 'running'))) {
    return { error: 'not_pending', action: actionView((await getAction(owner, action.id))!) };
  }
  let result;
  try {
    result = await def.execute(ctx, action.input);
  } catch (err) {
    result = { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
  await finishAction(action.id, result.ok ? 'done' : 'failed', result);
  await audit({
    owner,
    conversationId: action.conversation_id,
    tool: action.tool,
    kind: 'execute',
    input: redact(action.input),
    outcome: result.ok ? 'done' : `failed: ${result.error ?? ''}`,
  });
  return { action: actionView((await getAction(owner, action.id))!) };
}
