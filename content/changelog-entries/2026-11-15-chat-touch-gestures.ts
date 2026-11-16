import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-chat-touch-gestures',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines on the phone: hold a message to react, reply or select it',
    es: 'Inbox y Lines en el teléfono: mantené apretado un mensaje para reaccionar, responder o elegirlo',
    pt: 'Inbox e Lines no celular: segure uma mensagem para reagir, responder ou selecioná-la',
  },
  items: [
    {
      product: 'inbox',
      en: 'Holding your finger on a message now marks it, shows the reactions on top and its actions at the bottom of the screen, the same ones as the arrow menu on a computer. It also works on links, photos and voice notes. Tap more messages to select them and forward, copy, star or delete them together. Swipe a message to the right to reply.',
      es: 'Mantener el dedo sobre un mensaje ahora lo marca, muestra las reacciones arriba y sus acciones abajo de la pantalla, las mismas del menú de la flecha en la computadora. También funciona sobre links, fotos y notas de voz. Tocá más mensajes para elegirlos y reenviarlos, copiarlos, destacarlos o borrarlos juntos. Deslizá un mensaje a la derecha para responder.',
      pt: 'Segurar o dedo sobre uma mensagem agora a marca, mostra as reações em cima e as ações na parte de baixo da tela, as mesmas do menu da seta no computador. Também funciona em links, fotos e mensagens de voz. Toque em mais mensagens para selecioná-las e encaminhar, copiar, favoritar ou apagar juntas. Deslize uma mensagem para a direita para responder.',
    },
    {
      product: 'inbox',
      en: 'The back button or gesture closes what you opened last (the message menu, the selection, the contact info, the open chat) instead of leaving Inbox. Holding a chat in the list opens its actions again.',
      es: 'El botón o el gesto de volver cierra lo último que abriste (el menú del mensaje, la selección, la info del contacto, el chat abierto) en lugar de salir de Inbox. Mantener apretado un chat de la lista vuelve a abrir sus acciones.',
      pt: 'O botão ou o gesto de voltar fecha o que você abriu por último (o menu da mensagem, a seleção, as informações do contato, a conversa aberta) em vez de sair do Inbox. Segurar uma conversa da lista volta a abrir as ações dela.',
    },
    {
      product: 'groups',
      en: 'Lines works the same way: hold a message for reactions and actions, tap others to select them, swipe right to reply, and back closes menus and panels first.',
      es: 'Lines funciona igual: mantené apretado un mensaje para las reacciones y acciones, tocá otros para elegirlos, deslizá a la derecha para responder, y volver cierra primero los menús y paneles.',
      pt: 'O Lines funciona do mesmo jeito: segure uma mensagem para as reações e ações, toque em outras para selecioná-las, deslize para a direita para responder, e voltar fecha primeiro os menus e painéis.',
    },
  ],
} satisfies ChangelogEntry;
