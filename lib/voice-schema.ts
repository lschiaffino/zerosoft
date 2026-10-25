import { z } from 'zod';

/** Plantilla propia de notas de reunión (nombre + qué secciones o instrucciones). */
export const voiceTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  instructions: z.string().max(4000),
});
