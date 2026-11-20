import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-settings-search',
  date: '2026-11-20',
  title: {
    en: 'Settings search: type a word and go straight to the setting',
    es: 'Búsqueda en Ajustes: escribís una palabra y vas directo al ajuste',
    pt: 'Busca nas configurações: digite uma palavra e vá direto à configuração',
  },
  items: [
    {
      product: 'platform',
      en: 'The search field at the top of Settings now finds individual settings, not only sections: "dark mode", "2FA", "keep archived" or "webhooks". Results are grouped by area with where they live (Lines › Settings › Tickets and SLA). Pick one and the page opens, scrolls to the setting and marks it for a moment. It understands English, Spanish and Portuguese words, ignores accents and forgives small typos, and only shows what you can open with your role and apps.',
      es: 'La caja de arriba de Ajustes ahora encuentra ajustes puntuales, no solo secciones: "modo oscuro", "2FA", "mantener archivado" o "webhooks". Los resultados van agrupados por área con dónde están (Lines › Ajustes › Tickets y SLA). Elegís uno y se abre la página, baja hasta el ajuste y lo marca un momento. Entiende palabras en español, inglés y portugués, no le importan las tildes, perdona errores de tipeo chicos y solo muestra lo que podés abrir con tu rol y tus apps.',
      pt: 'O campo no topo das Configurações agora encontra configurações específicas, não só seções: "modo escuro", "2FA", "manter arquivado" ou "webhooks". Os resultados vêm agrupados por área com onde ficam (Lines › Configurações › Tickets e SLA). Escolha um e a página abre, rola até a configuração e a destaca por um momento. Entende palavras em português, inglês e espanhol, ignora acentos, perdoa erros de digitação pequenos e só mostra o que você pode abrir com sua função e seus apps.',
    },
    {
      product: 'platform',
      en: 'The same search is in the header of each app\'s settings (CRM, Lines, Inbox, Track, Docs, Cal, Link and more) and in ⌘K. Press / or ⌘F inside settings to jump to it.',
      es: 'La misma búsqueda está en la cabecera de los ajustes de cada app (CRM, Lines, Inbox, Track, Docs, Cal, Link y más) y en ⌘K. Con / o ⌘F dentro de Ajustes vas directo a la caja.',
      pt: 'A mesma busca está no cabeçalho das configurações de cada app (CRM, Lines, Inbox, Track, Docs, Cal, Link e outros) e no ⌘K. Pressione / ou ⌘F dentro das configurações para ir direto ao campo.',
    },
  ],
} satisfies ChangelogEntry;
