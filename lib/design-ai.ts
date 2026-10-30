/**
 * Design: Magic write (texto con IA). Pasa por lib/ai.ts: cuota y rate limit
 * del workspace, uso registrado como 'design_write'. Server-only.
 */
import { aiGenerateText } from './ai';

export type MagicAction = 'write' | 'rewrite' | 'shorter' | 'longer' | 'formal' | 'casual';

const LANG: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

/** Instrucciones del modelo (exportada para los tests). */
export function magicInstructions(action: MagicAction, locale: string): string {
  const goal: Record<MagicAction, string> = {
    write: 'Write short copy for a graphic design (a social post, flyer, slide or banner) from the user request.',
    rewrite: 'Rewrite the text with different words, keeping the meaning and roughly the same length.',
    shorter: 'Make the text shorter, keeping the key message.',
    longer: 'Expand the text a little with one or two concrete details. Do not invent facts, numbers or names.',
    formal: 'Rewrite the text in a more formal, professional tone.',
    casual: 'Rewrite the text in a more casual, friendly tone.',
  };
  return [
    goal[action],
    'It goes on a design, so keep it tight: no more than 60 words unless the original is longer.',
    `Answer in ${action === 'write' ? (LANG[locale] ?? 'English') : 'the same language as the original text'}.`,
    'Return only the final text, without quotes, labels, markdown or explanations. Keep line breaks only if they help the layout.',
  ].join('\n');
}

export async function magicWrite(workspaceId: string, input: { action: MagicAction; text: string; prompt: string; locale: string }): Promise<string> {
  const prompt = input.action === 'write' ? input.prompt.trim() : input.text.trim();
  const res = await aiGenerateText({
    workspaceId,
    feature: 'design_write',
    instructions: magicInstructions(input.action, input.locale),
    prompt,
    maxOutputTokens: 400,
    temperature: 0.7,
    timeoutMs: 20_000,
  });
  return cleanOutput(res.text);
}

export function cleanOutput(text: string): string {
  return text
    .trim()
    .replace(/^["“”'`]+|["“”'`]+$/g, '')
    .replace(/\*\*/g, '')
    .trim()
    .slice(0, 4000);
}
