import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-2351-stickers-mine-first',
  date: '2026-11-19',
  title: {
    en: 'Lines and Inbox: the Stickers tab shows your stickers first',
    es: 'Lines e Inbox: la pestaña Stickers muestra primero tus stickers',
    pt: 'Lines e Inbox: a aba Figurinhas mostra primeiro as suas figurinhas',
  },
  items: [
    {
      product: 'inbox',
      en: 'The Stickers tab now has Recent, Favorites and Created by you, like WhatsApp. Recent lists the stickers you sent from that account, including the ones sent from your phone, newest first. Stickers other people sent in your chats go to a folded "From your chats" section, and move up when you send one or add it to favorites.',
      es: 'La pestaña Stickers ahora tiene Recientes, Favoritos y Creados por vos, como WhatsApp. Recientes muestra los stickers que mandaste desde esa cuenta, también los que mandaste desde el teléfono, del más nuevo al más viejo. Los que otras personas mandaron en tus chats van a "De tus chats", plegado, y suben cuando mandás uno o lo agregás a favoritos.',
      pt: 'A aba Figurinhas agora tem Recentes, Favoritas e Criadas por você, como o WhatsApp. Recentes mostra as figurinhas que você enviou dessa conta, inclusive as enviadas pelo celular, da mais nova para a mais antiga. As que outras pessoas enviaram nas suas conversas vão para "Das suas conversas", recolhido, e sobem quando você envia uma ou adiciona aos favoritos.',
    },
    {
      product: 'groups',
      en: 'The Stickers tab of each number shows Recent, Favorites and Created by you first. Recent includes stickers you sent from this number in Lines and the ones sent from the number\'s phone in chats you can see. Received stickers go to a folded "From your chats" section.',
      es: 'La pestaña Stickers de cada número muestra primero Recientes, Favoritos y Creados por vos. Recientes suma los stickers que mandaste desde ese número en Lines y los que salieron desde el teléfono del número en los chats que ves. Los recibidos van a "De tus chats", plegado.',
      pt: 'A aba Figurinhas de cada número mostra primeiro Recentes, Favoritas e Criadas por você. Recentes inclui as figurinhas que você enviou desse número no Lines e as enviadas pelo celular do número nas conversas que você vê. As recebidas vão para "Das suas conversas", recolhido.',
    },
  ],
} satisfies ChangelogEntry;
