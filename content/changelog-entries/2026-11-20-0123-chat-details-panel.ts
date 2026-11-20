import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-0123-chat-details-panel',
  date: '2026-11-20',
  title: {
    en: 'Lines and Inbox: a calmer chat details panel, and the CRM section only with CRM on',
    es: 'Lines e Inbox: un panel de detalles del chat más prolijo, y la sección CRM solo con CRM prendido',
    pt: 'Lines e Inbox: um painel de detalhes do chat mais organizado, e a seção CRM só com o CRM ligado',
  },
  items: [
    {
      product: 'groups',
      en: 'The details panel on the right of a chat mixed text sizes: the HubSpot property values were small while the selects, search fields and buttons were form size, and "Choose properties" and "All properties" were heavier than the section title. Now the panel uses one size for values, fields and buttons, gray labels of the same size and smaller help text. Its controls are compact (28px), the header actions are quiet links, and a linked HubSpot record shows its name with an icon that says it opens HubSpot. The same applies to the HubSpot card in the Inbox contact info.',
      es: 'El panel de detalles a la derecha de un chat mezclaba tamaños de letra: los valores de las propiedades de HubSpot eran chicos y los selectores, buscadores y botones tenían tamaño de formulario, y "Elegir propiedades" y "Todas las propiedades" pesaban más que el título de la sección. Ahora el panel usa un solo tamaño para valores, campos y botones, rótulos grises del mismo tamaño y ayudas más chicas. Los controles son compactos (28px), las acciones del título son links tranquilos y un registro de HubSpot vinculado muestra su nombre con un ícono que indica que abre HubSpot. Lo mismo vale para la tarjeta de HubSpot en la info del contacto de Inbox.',
      pt: 'O painel de detalhes à direita de um chat misturava tamanhos de letra: os valores das propriedades do HubSpot eram pequenos e os seletores, buscas e botões tinham tamanho de formulário, e "Escolher propriedades" e "Todas as propriedades" pesavam mais que o título da seção. Agora o painel usa um só tamanho para valores, campos e botões, rótulos cinza do mesmo tamanho e ajudas menores. Os controles são compactos (28px), as ações do título são links discretos e um registro do HubSpot vinculado mostra o nome com um ícone que indica que abre o HubSpot. O mesmo vale para o cartão do HubSpot nas informações do contato do Inbox.',
    },
    {
      product: 'groups',
      en: 'The CRM section of the chat details (link a CRM company or contact) and "Save contact" (to the CRM) on a shared contact card only show when the CRM app is on for the workspace (Settings › Workspace apps) and the person can use it. With CRM off the server does not send any CRM data to the chat. Chats already linked to a CRM record keep the link.',
      es: 'La sección CRM de los detalles del chat (vincular una empresa o un contacto del CRM) y "Guardar" (en el CRM) en una tarjeta de contacto compartida solo aparecen con la app CRM prendida para el workspace (Ajustes › Apps del workspace) y si la persona puede usarla. Con CRM apagado el servidor no manda datos del CRM al chat. Los chats ya vinculados a un registro del CRM conservan el vínculo.',
      pt: 'A seção CRM dos detalhes do chat (vincular uma empresa ou um contato do CRM) e "Salvar" (no CRM) num cartão de contato compartilhado só aparecem com o app CRM ligado para o workspace (Ajustes › Apps do workspace) e se a pessoa pode usá-lo. Com o CRM desligado o servidor não envia dados do CRM ao chat. Os chats já vinculados a um registro do CRM mantêm o vínculo.',
    },
  ],
} satisfies ChangelogEntry;
