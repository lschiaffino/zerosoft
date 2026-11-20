/** Time: validación de los cuerpos de la API (compartida entre rutas). */
import { z } from 'zod';
import { MAX_ENTRY_MINUTES } from './types';

export const projectSchema = z.object({
  name: z.string().max(200).optional(),
  code: z.string().max(40).optional(),
  clientId: z.string().max(80).nullable().optional(),
  billable: z.boolean().optional(),
  rateCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  budgetMinutes: z
    .number()
    .int()
    .min(1)
    .max(MAX_ENTRY_MINUTES * 365 * 10)
    .nullable()
    .optional(),
  archived: z.boolean().optional(),
  everyone: z.boolean().optional(),
  people: z.array(z.string().min(1).max(80)).max(500).optional(),
  allTasks: z.boolean().optional(),
  tasks: z
    .array(z.object({ taskId: z.string().min(1).max(80), billable: z.boolean() }))
    .max(200)
    .optional(),
});

export const namedSchema = z.object({
  name: z.string().max(200).optional(),
  billable: z.boolean().optional(),
  archived: z.boolean().optional(),
});
