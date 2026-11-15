import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-fleet-chat',
  date: '2026-11-15',
  title: {
    en: 'Fleet: talk to your agents like in WhatsApp',
    es: 'Fleet: hablá con tus agentes como en WhatsApp',
    pt: 'Fleet: fale com seus agentes como no WhatsApp',
  },
  items: [
    {
      product: 'fleet',
      en: 'Each agent session is a conversation with your prompts, its answers and its notices. Write a reply and it waits in a queue: when the agent finishes its turn, the Claude Code Stop hook hands it your message and the agent keeps working with it. If the agent is idle, it gets the message with your next prompt. A clock shows a queued message, two ticks a delivered one, and blue ticks once the agent answered after it. You can take a message out of the queue before it is delivered, and rename, archive or delete a conversation.',
      es: 'Cada sesión de un agente es una conversación con tus prompts, sus respuestas y sus avisos. Escribí una respuesta y queda en cola: cuando el agente termina su turno, el Stop hook de Claude Code le pasa tu mensaje y el agente sigue trabajando con eso. Si el agente está quieto, le llega con tu próximo prompt. Un reloj marca un mensaje en cola, dos tildes uno entregado y tildes azules cuando el agente ya respondió después. Podés sacar un mensaje de la cola antes de que se entregue, y renombrar, archivar o borrar una conversación.',
      pt: 'Cada sessão de um agente é uma conversa com seus prompts, as respostas dele e os avisos. Escreva uma resposta e ela fica na fila: quando o agente termina o turno, o Stop hook do Claude Code entrega sua mensagem e o agente continua trabalhando com ela. Se o agente estiver parado, ele recebe com o seu próximo prompt. Um relógio marca uma mensagem na fila, dois ticks uma entregue e ticks azuis quando o agente já respondeu depois. Você pode tirar uma mensagem da fila antes de ser entregue, e renomear, arquivar ou excluir uma conversa.',
    },
  ],
} satisfies ChangelogEntry;
