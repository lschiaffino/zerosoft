import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-reply-privately',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: Reply privately and Message from a group message',
    es: 'Inbox y Lines: Responder en privado y Enviar mensaje desde un mensaje de grupo',
    pt: 'Inbox e Lines: Responder em particular e Enviar mensagem a partir de uma mensagem de grupo',
  },
  items: [
    {
      product: 'inbox',
      en: 'The menu of a message someone else sent in a group now has Reply privately, which opens your one on one chat with that person already replying to the group message, and Message followed by their name, which opens that chat. The reply shows the quote with the group name, like on WhatsApp, and the other phone sees it the same way. The menu also follows the WhatsApp order and gained Download for photos, videos and files.',
      es: 'El menú de un mensaje que otra persona mandó en un grupo ahora tiene Responder en privado, que abre tu chat individual con esa persona ya respondiendo al mensaje del grupo, y Enviar mensaje a seguido de su nombre, que abre ese chat. La respuesta muestra la cita con el nombre del grupo, como en WhatsApp, y el otro teléfono la ve igual. El menú también sigue el orden de WhatsApp y suma Descargar para fotos, videos y archivos.',
      pt: 'O menu de uma mensagem que outra pessoa mandou em um grupo agora tem Responder em particular, que abre sua conversa individual com a pessoa já respondendo à mensagem do grupo, e Enviar mensagem para seguido do nome dela, que abre essa conversa. A resposta mostra a citação com o nome do grupo, como no WhatsApp, e o outro celular vê do mesmo jeito. O menu também segue a ordem do WhatsApp e ganhou Baixar para fotos, vídeos e arquivos.',
    },
    {
      product: 'groups',
      en: 'Lines has the same two options in the group message menu, on the same line, and its menu now follows the WhatsApp order: Delete and Select messages at the end, with the team options (ticket, task) below.',
      es: 'Lines tiene las mismas dos opciones en el menú de un mensaje de grupo, en la misma línea, y su menú ahora sigue el orden de WhatsApp: Eliminar y Seleccionar mensajes al final, con las opciones del equipo (ticket, tarea) debajo.',
      pt: 'O Lines tem as mesmas duas opções no menu de uma mensagem de grupo, na mesma linha, e o menu agora segue a ordem do WhatsApp: Apagar e Selecionar mensagens no fim, com as opções da equipe (ticket, tarefa) embaixo.',
    },
  ],
} satisfies ChangelogEntry;
