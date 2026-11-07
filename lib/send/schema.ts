import { z } from 'zod';

/** Reglas de un link, al crearlo y al cambiarlo. */
export const linkSchema = z.object({
  name: z.string().max(120).optional(),
  recipientEmail: z.string().max(254).nullable().optional(),
  requireEmail: z.boolean().optional(),
  verifyEmail: z.boolean().optional(),
  passcode: z.string().max(100).nullable().optional(),
  expiresAt: z.string().max(40).nullable().optional(),
  allowDownload: z.boolean().optional(),
  accessMode: z.enum(['none', 'allow', 'block']).optional(),
  accessList: z.array(z.string().max(300)).max(1000).optional(),
  watermark: z.boolean().optional(),
  ndaTemplateId: z.string().max(60).nullable().optional(),
  message: z.string().max(1000).optional(),
  notify: z.boolean().optional(),
  useBranding: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
