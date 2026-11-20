import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-assistant-feature-requests',
  date: '2026-11-19',
  title: {
    en: 'Assistant: ask for something we do not do yet and it goes to the team',
    es: 'Asistente: pedí algo que todavía no hacemos y le llega al equipo',
    pt: 'Assistente: peça algo que ainda não fazemos e chega à equipe',
  },
  items: [
    {
      product: 'platform',
      en: 'When you ask the assistant for something the product cannot do yet, it helps with what is possible now, records your request for the team in your own words and tells you it was recorded. If someone already asked for the same thing, your request is added to theirs. Requests are private: they do not show up on the public board unless the team publishes them. Something broken goes to the team as a problem report instead.',
      es: 'Cuando le pedís al asistente algo que el producto todavía no hace, te ayuda con lo que se puede hacer ahora, anota tu pedido para el equipo con tus palabras y te avisa que quedó anotado. Si alguien ya pidió lo mismo, tu pedido se suma al suyo. Los pedidos son privados: no aparecen en el board público salvo que el equipo los publique. Si algo anda mal, le llega al equipo como un reporte de problema.',
      pt: 'Quando você pede ao assistente algo que o produto ainda não faz, ele ajuda com o que dá para fazer agora, registra o seu pedido para a equipe com as suas palavras e avisa que ficou registrado. Se alguém já pediu a mesma coisa, o seu pedido se soma ao dessa pessoa. Os pedidos são privados: não aparecem no board público a menos que a equipe os publique. Se algo não funciona, chega à equipe como um relato de problema.',
    },
  ],
} satisfies ChangelogEntry;
