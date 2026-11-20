/**
 * Social: escribir con IA dentro del compositor (como el OwlyWriter de
 * Hootsuite). Dos pedidos: armar una publicación desde una idea, o cambiar el
 * texto que ya está (más corto, más largo, más informal, más formal, corregir).
 * Respeta el límite de caracteres más chico de las redes elegidas. Todo pasa
 * por lib/ai.ts (cuota, rate limit y ai_usage, feature `social_compose`).
 *
 * En e2e (SOCIAL_AI_FAKE=1, nunca en un deploy de producción) corre contra el
 * modelo falso de lib/crm-ai-fake.ts; la cookie social_ai_fake=off simula la
 * IA apagada (error ai_disabled). Server-only.
 */
import { generateText, type LanguageModel } from 'ai';
import { aiEnabled, AiError, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { DATA_RULE, fence } from './ai-compose';
import { fakeModel, type FakeCallInfo } from './crm-ai-fake';
import { NETWORK_SPECS, type SocialNetwork } from './social-networks';

export const SOCIAL_AI_CHANGES = ['shorter', 'longer', 'casual', 'formal', 'fix'] as const;
export type SocialAiChange = (typeof SOCIAL_AI_CHANGES)[number];

export function isSocialAiChange(v: unknown): v is SocialAiChange {
  return typeof v === 'string' && (SOCIAL_AI_CHANGES as readonly string[]).includes(v);
}

const CHANGE_RULE: Record<SocialAiChange, string> = {
  shorter: 'Make it shorter and punchier. Keep every fact, link, hashtag and mention.',
  longer: 'Make it a little longer and more complete. Do not add facts, dates, prices, links or promises that are not already there.',
  casual: 'Make it more casual and friendly, the way a small brand talks to people who follow it.',
  formal: 'Make it more professional and polished, for a company page.',
  fix: 'Fix spelling, grammar and punctuation only. Change nothing else.',
};

const LOCALE_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

/** Hasta dónde se puede escribir: el límite más chico de las redes elegidas (o 500 sin redes). */
export function socialAiLimit(networks: SocialNetwork[]): number {
  const limits = networks.map((n) => NETWORK_SPECS[n]?.limit).filter((n): n is number => typeof n === 'number' && n > 0);
  return limits.length ? Math.min(...limits) : 500;
}

async function fakeState(): Promise<'on' | 'off' | null> {
  if (process.env.SOCIAL_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return null;
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('social_ai_fake')?.value === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

/** ¿Se ofrece "Escribir con IA" en el compositor? */
export function socialAiOffered(): boolean {
  return aiEnabled() || (process.env.SOCIAL_AI_FAKE === '1' && process.env.VERCEL_ENV !== 'production');
}

/** Respuesta del modelo falso: determinística, armada con lo que se le pidió. */
function fakeAnswer(info: FakeCallInfo): string {
  const prompt = info.userTexts[info.userTexts.length - 1] ?? '';
  const idea = /<request>\n([\s\S]*?)\n<\/request>/.exec(prompt)?.[1]?.trim();
  const text = /<text>\n([\s\S]*?)\n<\/text>/.exec(prompt)?.[1]?.trim() ?? '';
  const change = /Change: (\w+)/.exec(info.system)?.[1];
  if (idea) return `${idea.charAt(0).toUpperCase()}${idea.slice(1)}. Come see us this week! #news`;
  if (change === 'shorter') return text.split(/(?<=[.!?])\s/)[0] ?? text;
  if (change === 'fix') return text;
  return `${text} (${change})`;
}

export interface SocialAiInput {
  ws: string;
  locale: string;
  networks: SocialNetwork[];
  /** Idea para una publicación nueva. */
  idea?: string;
  /** Texto a cambiar, con `change`. */
  text?: string;
  change?: SocialAiChange;
}

/** Texto de la publicación, listo para poner en el compositor. */
export async function writeSocialPost(input: SocialAiInput): Promise<string> {
  const idea = input.idea?.trim().slice(0, 1000) ?? '';
  const text = input.text?.trim().slice(0, 5000) ?? '';
  const rewriting = Boolean(input.change && text);
  if (!rewriting && !idea) throw new AiError('ai_disabled');
  const limit = socialAiLimit(input.networks);
  const names = input.networks.map((n) => NETWORK_SPECS[n]?.name).filter(Boolean);

  const state = await fakeState();
  let model: LanguageModel;
  let modelId: string;
  if (state === 'on') {
    await assertAiQuota(input.ws);
    model = fakeModel((info) => ({ text: fakeAnswer(info) }));
    modelId = 'social-fake';
  } else if (state === 'off') {
    throw new AiError('ai_disabled');
  } else {
    await assertAiAvailable(input.ws);
    ({ model, modelId } = resolveAiModel());
  }

  const rules = [
    'You write social media posts for a small business.',
    names.length ? `The post goes to: ${names.join(', ')}.` : '',
    `Keep it under ${limit} characters, counting links as written.`,
    'Plain text only: no markdown, no quotes around the post, no title, no explanation before or after. Emojis and hashtags only if they fit; at most three hashtags.',
    'Do not invent prices, dates, discounts, addresses, links or claims the user did not give.',
    DATA_RULE,
  ];
  let prompt: string;
  if (rewriting) {
    rules.push(`Change: ${input.change}. ${CHANGE_RULE[input.change as SocialAiChange]}`, 'Answer in the same language as the text.');
    prompt = fence('text', text);
  } else {
    rules.push(`Write in ${LOCALE_NAME[input.locale] ?? 'English'} unless the request asks for or is written in another language.`);
    prompt = fence('request', idea);
  }

  const result = await generateText({
    model,
    instructions: rules.filter(Boolean).join(' '),
    prompt,
    maxOutputTokens: 700,
    temperature: rewriting ? 0.3 : 0.7,
    timeout: 30_000,
    maxRetries: 1,
  });
  await recordAiUsage({
    workspaceId: input.ws,
    feature: 'social_compose',
    model: modelId,
    inputTokens: result.totalUsage?.inputTokens ?? 0,
    outputTokens: result.totalUsage?.outputTokens ?? 0,
  }).catch(() => {});
  return cleanPost(result.text);
}

/** Saca comillas que envuelven todo y espacios sobrantes; el modelo a veces los agrega. */
export function cleanPost(raw: string): string {
  let s = raw.trim();
  if (s.length > 1 && /^["“«]/.test(s) && /["”»]$/.test(s)) s = s.slice(1, -1).trim();
  return s.replace(/\n{3,}/g, '\n\n');
}
