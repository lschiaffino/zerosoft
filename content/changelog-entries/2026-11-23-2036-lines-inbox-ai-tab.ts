import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-lines-inbox-ai-tab',
  date: '2026-11-23',
  title: {
    en: 'Lines and Inbox: an AI tab to catch up on a chat',
    es: 'Lines e Inbox: una pestaña IA para ponerte al día con un chat',
    pt: 'Lines e Inbox: uma aba IA para colocar uma conversa em dia',
  },
  items: [
    {
      product: 'groups',
      en: "The chat panel has a new AI tab. Pick since you last read the chat, the last 24 hours, 7 or 30 days, and get a summary, the open questions, the pending commitments, a few suggested replies and the contact's mood. Insert puts a reply in the message field with Undo; nothing is sent. It only reads the messages you can see in that chat (no internal notes, phones hidden if you don't see them) and saves nothing. When AI is off in the workspace, the tab says so.",
      es: 'El panel del chat tiene una pestaña IA nueva. Elegí desde la última vez que lo leíste, las últimas 24 horas, 7 o 30 días, y tenés un resumen, las preguntas sin responder, los compromisos pendientes, algunas respuestas sugeridas y el ánimo del contacto. Insertar pone una respuesta en el campo con Deshacer; no se manda nada. Solo lee los mensajes que ves en ese chat (sin notas internas, con los teléfonos ocultos si no los ves) y no guarda nada. Si la IA está apagada en el workspace, la pestaña lo dice.',
      pt: 'O painel da conversa tem uma aba IA nova. Escolha desde a última leitura, as últimas 24 horas, 7 ou 30 dias, e veja um resumo, as perguntas sem resposta, os compromissos pendentes, algumas respostas sugeridas e o ânimo do contato. Inserir coloca uma resposta no campo com Desfazer; nada é enviado. Só lê as mensagens que você vê nessa conversa (sem notas internas, com os telefones ocultos se você não os vê) e não salva nada. Se a IA está desligada no workspace, a aba avisa.',
    },
    {
      product: 'inbox',
      en: 'WhatsApp chats have the same AI tab, with your saved summary of the relationship at the top (it moved there from Info). Enter on a focused button in Inbox now presses that button instead of opening the chat under the cursor.',
      es: 'Los chats de WhatsApp tienen la misma pestaña IA, con tu resumen guardado de la relación arriba (se mudó ahí desde Info). En Inbox, Enter sobre un botón con el foco aprieta ese botón en vez de abrir el chat del cursor.',
      pt: 'As conversas do WhatsApp têm a mesma aba IA, com o seu resumo salvo da relação no topo (ele saiu de Info e foi para lá). No Inbox, Enter num botão com foco aperta esse botão em vez de abrir a conversa do cursor.',
    },
  ],
} satisfies ChangelogEntry;
