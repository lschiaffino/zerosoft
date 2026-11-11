'use client';

import { useTranslations } from 'next-intl';
import type { SlashCommand, SlashEnv } from '@/lib/slash-commands';
import { PencilSparkle } from './AiComposeBar';
import type { AiCompose } from './useAiCompose';

/**
 * Los comandos "/" de "Ayudame a escribir" (Lines e Inbox): lo mismo que
 * hacen los botones de la barra. Nunca mandan nada: abren la barra con un
 * borrador para revisar. Con `ai` en null (nota interna, edición) no hay.
 */
export function useAiSlashCommands(ai: AiCompose | null): SlashCommand[] {
  const t = useTranslations('common.slash.aiCommands');
  if (!ai) return [];
  const icon = <PencilSparkle size={18} />;
  const hasText = (env: SlashEnv) => env.rest.trim() !== '';
  const base = (id: string, key: string = id) => ({
    id,
    name: t(`${key}.name`),
    description: t(`${key}.desc`),
    keywords: t(`${key}.keys`).split(/\s+/).filter(Boolean),
    section: 'ai' as const,
    icon,
  });
  const out: SlashCommand[] = [{ ...base('write'), aliases: ['write', 'ai', 'draft'], shortcut: '⌘J', run: ai.openBar }];
  if (ai.adapter.canSuggest) {
    out.push({
      ...base('suggest'),
      aliases: ['suggest'],
      run: () => {
        ai.openBar();
        ai.suggest();
      },
    });
  }
  // Los cambios trabajan sobre lo escrito: sin texto no se ofrecen.
  for (const change of ['polish', 'shorter', 'formal', 'fix'] as const) {
    out.push({
      ...base(change),
      aliases: [change],
      available: hasText,
      run: () => {
        ai.openBar();
        ai.refine(change);
      },
    });
  }
  const seen = new Set<string>();
  const languages = (ai.adapter.languages ?? []).filter((l) => !seen.has(l.code) && seen.add(l.code));
  if (languages.length > 0) {
    out.push({
      ...base('translate'),
      aliases: ['translate', 'language'],
      available: hasText,
      emptyText: t('translate.empty'),
      args: () => languages.map((l) => ({ id: l.code, label: l.label, keywords: [l.code] })),
      run: (o) => {
        if (!o) return;
        ai.openBar();
        ai.translate(o.id);
      },
    });
  }
  return out;
}
