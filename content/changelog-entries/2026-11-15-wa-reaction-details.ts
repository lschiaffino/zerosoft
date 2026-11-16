import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-reaction-details',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: see who reacted to a message',
    es: 'Inbox y Lines: quién reaccionó a un mensaje',
    pt: 'Inbox e Lines: quem reagiu a uma mensagem',
  },
  items: [
    {
      product: 'inbox',
      en: 'Click the reactions under a message, or hold them on the phone, and a card like WhatsApp’s shows who reacted: their photo, their name (with ~ when it is only their WhatsApp profile name), their number and their emoji. There is a tab for each emoji to filter the list and a button to react. Your own reaction comes first as “You”: click it to remove it. On the phone the card opens from the bottom. Quick reactions, the emoji picker, menus and the emoji tray now all close the same way: a tap outside, Esc, or picking something, and opening one closes the other.',
      es: 'Un clic en las reacciones debajo de un mensaje, o mantenerlas apretadas en el teléfono, abre una tarjeta como la de WhatsApp con quién reaccionó: su foto, su nombre (con ~ cuando es solo su nombre de perfil de WhatsApp), su número y su emoji. Hay una pestaña por emoji para filtrar la lista y un botón para reaccionar. La tuya va primero como “Vos”: un clic la saca. En el teléfono la tarjeta sale desde abajo. Las reacciones rápidas, el selector de emojis, los menús y la bandeja de emojis ahora se cierran todos igual: un toque afuera, Esc o al elegir algo, y abrir uno cierra el otro.',
      pt: 'Um clique nas reações embaixo de uma mensagem, ou segurar no celular, abre um cartão como o do WhatsApp com quem reagiu: a foto, o nome (com ~ quando é só o nome de perfil do WhatsApp), o número e o emoji. Há uma aba por emoji para filtrar a lista e um botão para reagir. A sua vem primeiro como “Você”: um clique remove. No celular o cartão abre de baixo. As reações rápidas, o seletor de emojis, os menus e a bandeja de emojis agora fecham todos do mesmo jeito: um toque fora, Esc ou ao escolher algo, e abrir um fecha o outro.',
    },
    {
      product: 'groups',
      en: 'Lines has the same card on every line, and the quick reactions get a + to react with any emoji. People who are not allowed to see phone numbers get the number masked by the server, the same rule as the contact card.',
      es: 'Lines tiene la misma tarjeta en cada línea, y las reacciones rápidas suman un + para reaccionar con cualquier emoji. Quien no tiene permiso para ver números recibe el número enmascarado desde el servidor, con la misma regla que la ficha del contacto.',
      pt: 'O Lines tem o mesmo cartão em cada linha, e as reações rápidas ganham um + para reagir com qualquer emoji. Quem não tem permissão para ver números recebe o número mascarado pelo servidor, com a mesma regra da ficha do contato.',
    },
  ],
} satisfies ChangelogEntry;
