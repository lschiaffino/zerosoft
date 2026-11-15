import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/session';
import { renderAssistantMarkdown } from '@/lib/assistant/markdown';
import { setAssistantModelOverride } from '@/lib/assistant/config';
import { runAssistantTurn, type AssistantEvent } from '@/lib/assistant/engine';
import { addMessage, createConversation, listMessages } from '@/lib/assistant/store';
import { fakeModel } from '@/lib/crm-ai-fake';
import { makeUser } from './helpers';

describe('Markdown del asistente', () => {
  it('títulos, listas, tablas en su caja y código con copiar', () => {
    const html = renderAssistantMarkdown('## Plan\n\n- uno\n- dos\n\n| A | B |\n| --- | ---: |\n| x | 1 |\n\n```json\n{"a": 1}\n```', { copy: 'Copiar' });
    expect(html).toContain('<h2>Plan</h2>');
    expect(html).toContain('<li>uno</li>');
    expect(html).toContain('<div class="table-wrap asst-table"><table class="table table-compact">');
    expect(html).toContain('<th scope="col" style="text-align:right">B</th>');
    expect(html).toContain('<button type="button" class="asst-code-copy" data-copy-code>Copiar</button>');
    expect(html).toContain('<span class="asst-code-lang">json</span>');
  });

  it('sin HTML crudo ni links peligrosos; las imágenes quedan como link', () => {
    const html = renderAssistantMarkdown('<img src=x onerror=alert(1)> [a](javascript:alert(1)) [b](/app/inbox) [c](https://x.com) ![i](https://evil.example/p.png) <script>alert(1)</script>');
    expect(html).not.toMatch(/<img|<script|href="javascript/i);
    expect(html).toContain('&lt;img');
    expect(html).toContain('<a href="/app/inbox">b</a>');
    expect(html).toContain('<a href="https://x.com" target="_blank" rel="nofollow noopener noreferrer">c</a>');
    expect(html).toContain('<a href="https://evil.example/p.png" target="_blank" rel="nofollow noopener noreferrer">i</a>');
  });

  it('el cursor queda al final del último bloque y nunca dentro de una etiqueta', () => {
    expect(renderAssistantMarkdown('Hola\n\n', { cursor: true })).toBe('<p>Hola<span class="asst-cursor" aria-hidden="true"></span></p>');
    const link = renderAssistantMarkdown('mirá https://zerosoft.ai', { cursor: true });
    expect(link).toContain('href="https://zerosoft.ai"');
    expect(link).toMatch(/<\/a><span class="asst-cursor"|<span class="asst-cursor" aria-hidden="true"><\/span><\/a>/);
    expect(renderAssistantMarkdown('- a\n- b', { cursor: true })).toMatch(/<li>b<span class="asst-cursor"[^>]*><\/span><\/li>/);
    // Una tabla o un bloque a medio llegar no rompe nada.
    expect(() => renderAssistantMarkdown('| A | B |\n| --- |', { cursor: true })).not.toThrow();
    expect(renderAssistantMarkdown('```js\nconst a = 1', { cursor: true })).toContain('asst-cursor');
    expect(renderAssistantMarkdown('', { cursor: true })).toContain('asst-cursor');
    expect(renderAssistantMarkdown('   ')).toBe('');
  });
});

describe('razonamiento del modelo', () => {
  afterEach(() => {
    setAssistantModelOverride(null);
    vi.unstubAllEnvs();
  });

  it('llega como eventos, se guarda plegado con lo que tardó y no vuelve al historial del modelo', async () => {
    const u = await makeUser('asst-reason');
    const user = { ...u, role: 'owner', apps: '*' } as unknown as SessionUser;
    let seen = '';
    setAssistantModelOverride(
      fakeModel((info) => {
        seen = info.userTexts.join('|');
        return { reasoning: 'Pienso en la pregunta.', text: '**Listo**' };
      }),
    );
    const owner = { workspaceId: u.id, personId: u.id };
    const conv = await createConversation(owner, 'x');
    await addMessage(conv.id, 'user', 'hola');
    const events: AssistantEvent[] = [];
    for await (const e of runAssistantTurn({ user, conversationId: conv.id, message: 'hola', page: null, locale: 'es' })) events.push(e);
    const reasoning = events.filter((e) => e.type === 'reasoning').map((e) => (e as { delta: string }).delta).join('');
    expect(reasoning).toBe('Pienso en la pregunta.');
    const end = events.findIndex((e) => e.type === 'reasoning-end');
    expect(end).toBeGreaterThan(-1);
    expect(events.findIndex((e) => e.type === 'text')).toBeGreaterThan(end);
    const saved = (await listMessages(conv.id)).find((m) => m.role === 'assistant')!;
    expect(saved.content).toBe('**Listo**');
    expect(saved.parts).toEqual([expect.objectContaining({ type: 'reasoning', text: 'Pienso en la pregunta.' })]);

    // Segundo turno: el razonamiento anterior no se manda de vuelta.
    await addMessage(conv.id, 'user', 'otra');
    for await (const e of runAssistantTurn({ user, conversationId: conv.id, message: 'otra', page: null, locale: 'es' })) void e;
    expect(seen).not.toContain('Pienso');
  });
});
