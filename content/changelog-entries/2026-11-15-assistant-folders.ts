import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-assistant-folders',
  date: '2026-11-15',
  title: {
    en: 'Assistant: always answers, sets up your folders from a file, and a panel you can pin',
    es: 'Asistente: siempre responde, arma tus carpetas desde un archivo y un panel que se puede fijar',
    pt: 'Assistente: sempre responde, monta suas pastas a partir de um arquivo e um painel que pode ser fixado',
  },
  items: [
    {
      product: 'platform',
      en: 'The assistant no longer stops in silence on a long request. When it runs out of steps or something fails, it still tells you what it did, what is waiting for your confirmation and what it needs from you. It also takes fewer steps to find how to do something.',
      es: 'El asistente ya no se queda callado en un pedido largo. Si se le acaban los pasos o algo falla, igual te dice qué hizo, qué espera tu confirmación y qué necesita de vos. Además da menos vueltas para encontrar cómo hacer algo.',
      pt: 'O assistente não fica mais em silêncio num pedido longo. Se os passos acabam ou algo falha, ele ainda diz o que fez, o que espera sua confirmação e o que precisa de você. Ele também dá menos voltas para descobrir como fazer algo.',
    },
    {
      product: 'inbox',
      en: 'Attach or paste the JSON exported from another inbox (Inbox Zero, labels and rules from your email, a folder tree) and ask the assistant to set up your folders. You get one card with every folder and chat it will create, including the ones it could not find, and nothing changes until you click Confirm. Running it again only does what is missing.',
      es: 'Adjuntá o pegá el JSON exportado de otra bandeja (Inbox Zero, etiquetas y reglas de tu correo, un árbol de carpetas) y pedile al asistente que arme tus carpetas. Ves una sola tarjeta con todas las carpetas y chats que va a crear, también los que no encontró, y nada cambia hasta que tocás Confirmar. Repetirlo solo hace lo que falta.',
      pt: 'Anexe ou cole o JSON exportado de outra caixa (Inbox Zero, marcadores e regras do seu e-mail, uma árvore de pastas) e peça ao assistente para montar suas pastas. Você vê um só cartão com todas as pastas e conversas que ele vai criar, inclusive as que não encontrou, e nada muda até você clicar em Confirmar. Repetir só faz o que falta.',
    },
    {
      product: 'groups',
      en: 'The same works for the shared Lines folders, and you can ask for Inbox and Lines at once: one card covers both. Only the chats you can see are used, and chats already in a folder stay there unless you ask to move them.',
      es: 'Lo mismo sirve para las carpetas compartidas de Lines, y podés pedir Inbox y Lines a la vez: una tarjeta cubre las dos. Solo usa los chats que ves, y los que ya están en una carpeta se quedan ahí salvo que pidas moverlos.',
      pt: 'O mesmo vale para as pastas compartilhadas do Lines, e você pode pedir Inbox e Lines de uma vez: um cartão cobre os dois. Só usa as conversas que você vê, e as que já estão numa pasta ficam lá a menos que você peça para movê-las.',
    },
    {
      product: 'platform',
      en: 'While the assistant works you see what it is doing in a small box with plain steps ("Reading your file and matching the chats"), and when it is done the steps fold into one line you can open. The panel can be pinned to the side so the page moves over instead of being covered, made wider by dragging its edge, or opened full screen. Width and position are remembered.',
      es: 'Mientras el asistente trabaja ves qué está haciendo en una caja chica con pasos en lenguaje común ("Leyendo tu archivo y buscando los chats"), y al terminar los pasos se pliegan en una línea que podés abrir. El panel se puede fijar al costado para que la página se corra en vez de quedar tapada, ensanchar arrastrando el borde o abrir a pantalla completa. Se acuerda del ancho y la posición.',
      pt: 'Enquanto o assistente trabalha você vê o que ele está fazendo numa caixa pequena com passos em linguagem simples ("Lendo seu arquivo e procurando as conversas"), e quando termina os passos se recolhem numa linha que você pode abrir. O painel pode ser fixado ao lado para a página se ajustar em vez de ficar coberta, alargado arrastando a borda ou aberto em tela cheia. Ele lembra a largura e a posição.',
    },
  ],
} satisfies ChangelogEntry;
