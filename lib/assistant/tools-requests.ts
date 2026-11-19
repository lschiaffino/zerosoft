/**
 * Pedidos al equipo desde el asistente: funciones que el producto todavía no
 * tiene (request_feature) y problemas (report_problem). Corren en el turno,
 * sin tarjeta de confirmación: solo anotan lo que la persona pidió en el
 * backlog interno (privado; ver lib/feature-requests.ts), no cambian nada
 * del workspace.
 */
import { z } from 'zod';
import { PRODUCT_KEYS } from '../product-taxonomy';
import { rateLimit } from '../rate-limit';
import { FEATURE_DETAILS_MAX, FEATURE_TITLE_MAX, recordFeatureRequest, recordProblemReport } from '../feature-requests';
import { readTool, type AssistantTool, type ToolCtx } from './registry';

const requestInput = z.object({
  title: z.string().trim().min(3).max(FEATURE_TITLE_MAX).describe('Short, neutral title in English, imperative ("Edit HubSpot fields from Inbox with two-way sync"). No names, emails or customer data.'),
  details: z.string().trim().max(FEATURE_DETAILS_MAX).default('').describe("The person's need in their own words (what they want to do and why), in their language. No emails, phone numbers or other people's data."),
  app: z.string().trim().max(30).optional().describe(`The app it is about: ${PRODUCT_KEYS.join(', ')}. Use "other" when unclear.`),
});

function requester(ctx: ToolCtx) {
  const person = ctx.user.actingUser ?? ctx.user;
  return { personId: ctx.personId, email: person.email ?? null, workspaceId: ctx.workspaceId };
}

export const requestTools: AssistantTool[] = [
  readTool({
    name: 'request_feature',
    app: null,
    description:
      'Record a feature request for the zerosoft team when the person asks for something the product cannot do yet (or does differently). Call it once per distinct request, after helping with whatever is possible now. If the same thing was already requested, it adds this person to that request instead of creating a new one. Not for questions or bugs (use report_problem for something broken).',
    input: requestInput,
    run: async (ctx, input) => {
      const limit = await rateLimit(`assistant:feature:${ctx.personId}`, 20, 3600);
      if (!limit.ok) return { error: 'rate_limited' };
      const r = await recordFeatureRequest(requester(ctx), { title: input.title, details: input.details, product: input.app });
      return {
        recorded: true,
        title: input.title,
        addedToExisting: r.action === 'attached',
        askedBefore: r.askedBefore,
        priority: r.priority,
        ...(r.publicItem ? { publicItem: r.publicItem } : {}),
        note: 'Tell the person, in one short sentence in their language, that you recorded the request for the team and it will be considered. Do not promise a date or that it will be built. Do not mention priority.',
      };
    },
  }),
  readTool({
    name: 'report_problem',
    app: null,
    description:
      'Report a bug to the zerosoft team: something that should work and does not (an error, wrong result, something broken). Try to diagnose and help first; call this when it looks like a product problem. Not for feature requests (use request_feature) and never for security issues (tell the person to report those privately as the security policy says).',
    input: requestInput,
    run: async (ctx, input) => {
      const limit = await rateLimit(`assistant:problem:${ctx.personId}`, 20, 3600);
      if (!limit.ok) return { error: 'rate_limited' };
      await recordProblemReport(requester(ctx), { title: input.title, details: input.details, product: input.app });
      return { reported: true, title: input.title, note: 'Tell the person briefly that the problem was reported to the team.' };
    },
  }),
];
