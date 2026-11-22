/** CRM, vistas guardadas (B2): cuerpos de la API (app/api/crm/views). */
import { z } from 'zod';
import { MAX_TABS, VIEW_ENTITIES, VIEW_VISIBILITIES } from './crm-views-shared';

const query = z.record(z.string().max(4000)).refine((q) => Object.keys(q).length <= 120);
const teamId = z.string().min(1).max(100).nullable().optional();

export const viewCreateSchema = z.object({
  entity: z.enum(VIEW_ENTITIES),
  name: z.string().trim().min(1).max(200),
  query: query.optional(),
  visibility: z.enum(VIEW_VISIBILITIES).optional(),
  teamId,
});

export const viewPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    query: query.optional(),
    visibility: z.enum(VIEW_VISIBILITIES).optional(),
    teamId,
  })
  .refine((p) => Object.keys(p).length > 0);

export const viewTabsSchema = z.object({
  entity: z.enum(VIEW_ENTITIES),
  tabs: z.array(z.object({ key: z.string().min(1).max(100), pinned: z.boolean().optional() })).max(MAX_TABS),
});
