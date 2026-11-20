import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-reply-from-compact',
  date: '2026-11-19',
  title: {
    en: 'Lines and Inbox: a smaller "Reply from" picker',
    es: 'Lines e Inbox: el selector "Responder desde" más chico',
    pt: 'Lines e Inbox: o seletor "Responder de" menor',
  },
  items: [
    {
      product: 'groups',
      en: 'When the same chat comes in on two lines, the line you reply from is picked above the message box. The picker looked like a big form field, taller than the box itself and with a dark border. It is now a compact line of text the size of its label, and shows its border only on hover or focus.',
      es: 'Cuando el mismo chat llega por dos líneas, la línea desde la que respondés se elige arriba de la caja del mensaje. El selector parecía un campo de formulario grande, más alto que la propia caja y con borde oscuro. Ahora es una línea de texto compacta, del tamaño de su etiqueta, y muestra el borde solo al pasar el mouse o al enfocarlo.',
      pt: 'Quando a mesma conversa chega por duas linhas, a linha de onde você responde é escolhida acima da caixa da mensagem. O seletor parecia um campo de formulário grande, mais alto que a própria caixa e com borda escura. Agora é uma linha de texto compacta, do tamanho do rótulo, e mostra a borda só ao passar o mouse ou ao focar.',
    },
  ],
} satisfies ChangelogEntry;
