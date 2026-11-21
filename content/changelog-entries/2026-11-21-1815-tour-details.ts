import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-tour-details',
  date: '2026-11-21',
  title: {
    en: 'Guided tours without keyboard shortcuts on your phone',
    es: 'Tours guiados sin atajos de teclado en el teléfono',
    pt: 'Tours guiados sem atalhos de teclado no celular',
  },
  items: [
    {
      product: 'platform',
      en: 'On a phone or a touch screen, the guided tours no longer mention keyboard shortcuts, and the steps that only teach shortcuts are skipped.',
      es: 'En el teléfono o en una pantalla táctil, los tours guiados ya no nombran atajos de teclado, y los pasos que solo enseñan atajos se saltean.',
      pt: 'No celular ou numa tela sensível ao toque, os tours guiados não citam mais atalhos de teclado, e as etapas que só ensinam atalhos são puladas.',
    },
    {
      product: 'talk',
      en: 'The Talk tour now also points out Analytics and Talk settings in the sidebar.',
      es: 'El tour de Talk ahora también señala Analítica y los ajustes de Talk en el lateral.',
      pt: 'O tour do Talk agora também mostra Análises e os ajustes do Talk na lateral.',
    },
    {
      product: 'platform',
      en: 'In the Retro, Classic and Liquid looks, short empty messages inside a section (like "No links yet" in Send) are plain text again: in Retro the box cut off their first letter.',
      es: 'En los aspectos Retro, Clásico y Líquido, los mensajes cortos de vacío dentro de una sección (como "Todavía no hay links" en Send) vuelven a ser texto simple: en Retro la caja les cortaba la primera letra.',
      pt: 'Nos visuais Retro, Clássico e Líquido, as mensagens curtas de vazio dentro de uma seção (como "Ainda não há links" no Send) voltam a ser texto simples: no Retro a caixa cortava a primeira letra.',
    },
  ],
} satisfies ChangelogEntry;
