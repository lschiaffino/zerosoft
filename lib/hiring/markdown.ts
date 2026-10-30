/**
 * Markdown chico para las descripciones de puesto: títulos (## y ###),
 * listas con "- ", párrafos, **negrita** y links http(s). Todo se escapa
 * antes: no pasa HTML del texto. Lo usan la página de empleos y el editor.
 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="nofollow noopener" target="_blank">$1</a>');
}

export function descriptionHtml(md: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br/>')}</p>`);
    para = [];
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushPara();
      continue;
    }
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) {
      flushList();
      flushPara();
      out.push(h[1].length === 2 ? `<h2>${inline(h[2])}</h2>` : `<h3>${inline(h[2])}</h3>`);
      continue;
    }
    const li = /^\s*[-*]\s+(.+)$/.exec(line);
    if (li) {
      flushPara();
      list.push(li[1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushList();
  flushPara();
  return out.join('');
}

export function descriptionText(md: string, max = 300): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
