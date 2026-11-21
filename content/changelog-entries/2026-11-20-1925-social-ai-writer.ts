import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1925-social-ai-writer',
  date: '2026-11-20',
  title: {
    en: 'Social: write posts with AI in the composer',
    es: 'Social: escribir publicaciones con IA en el compositor',
    pt: 'Social: escrever publicações com IA no editor',
  },
  items: [
    {
      product: 'social',
      en: 'The composer has a Write with AI button next to the text. Describe the post in a line and press Enter to get a draft, or change the text you already have: shorter, longer, more casual, more formal or with the spelling fixed. The AI keeps the post under the tightest character limit of the networks you picked, writes in the text of the network tab you have open when it has its own, and every change can be undone. It does not invent prices, dates or links you did not give. Uses the AI included in your plan.',
      es: 'El compositor tiene un botón Escribir con IA al lado del texto. Contá de qué se trata en una línea y Enter para tener un borrador, o cambiá el texto que ya está: más corto, más largo, más informal, más formal o con la ortografía corregida. La IA deja la publicación por debajo del límite de caracteres más chico de las redes elegidas, escribe en el texto de la red abierta cuando tiene uno propio, y cada cambio se puede deshacer. No inventa precios, fechas ni links que no le diste. Usa la IA incluida en tu plan.',
      pt: 'O editor tem um botão Escrever com IA ao lado do texto. Conte do que se trata em uma linha e aperte Enter para ter um rascunho, ou mude o texto que já está: mais curto, mais longo, mais informal, mais formal ou com a ortografia corrigida. A IA deixa a publicação abaixo do menor limite de caracteres das redes escolhidas, escreve no texto da rede aberta quando ela tem um próprio, e cada mudança pode ser desfeita. Não inventa preços, datas nem links que você não deu. Usa a IA incluída no seu plano.',
    },
  ],
} satisfies ChangelogEntry;
