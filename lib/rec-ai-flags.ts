import { recAiFake } from './rec-ai';

/**
 * Solo con REC_AI_FAKE=1 (e2e): la cookie rec_ai_fake=off hace que el
 * request se comporte como sin IA, para ver el error ai_disabled en la UI.
 * Se lee al encolar (la transcripción corre después, sin cookies).
 */
export async function recAiForcedOff(): Promise<boolean> {
  if (!recAiFake()) return false;
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('rec_ai_fake')?.value === 'off';
  } catch {
    return false;
  }
}
