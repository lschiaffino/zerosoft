/**
 * CRM — Markdown de los playbooks → HTML seguro (corre en server y browser).
 * Mismas reglas que lib/track-markdown.ts: el HTML crudo se escapa, los links
 * solo http(s), mailto o relativos, y las imágenes quedan como link.
 */
import { Marked, type Tokens } from 'marked';
import { escapeHtml, safeHref } from './track-markdown';

export const PLAYBOOK_MARKDOWN_MAX = 20_000;

const md = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      if (!href) return text;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="nofollow noopener noreferrer">${text}</a>`;
    },
    image(token: Tokens.Image) {
      const label = escapeHtml(token.text || token.href || '');
      const href = safeHref(token.href);
      if (!href) return label;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="nofollow noopener noreferrer">${label}</a>`;
    },
  },
});

export function renderPlaybookMarkdown(markdown: string): string {
  if (!markdown.trim()) return '';
  return (md.parse(markdown.slice(0, PLAYBOOK_MARKDOWN_MAX)) as string).trim();
}
