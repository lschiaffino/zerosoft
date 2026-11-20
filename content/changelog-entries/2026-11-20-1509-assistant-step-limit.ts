import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1509-assistant-step-limit',
  date: '2026-11-20',
  title: {
    en: 'Assistant: up to 8 steps per request, then a summary and Continue',
    es: 'Asistente: hasta 8 pasos por pedido, después un resumen y Seguir',
    pt: 'Assistente: até 8 passos por pedido, depois um resumo e Continuar',
  },
  items: [
    {
      product: 'platform',
      en: 'The assistant uses at most 8 tools per request (reading chats, searching, preparing folders). When it reaches that limit it stops using tools and tells you what it did, what is waiting for your confirmation and what is left. A note under the answer shows that it reached the limit, with a Continue button that picks up where it left off as a new request.',
      es: 'El asistente usa como mucho 8 herramientas por pedido (leer chats, buscar, preparar carpetas). Cuando llega a ese tope deja de usar herramientas y te cuenta qué hizo, qué espera tu confirmación y qué falta. Debajo de la respuesta un aviso muestra que llegó al tope, con un botón Seguir que retoma desde donde quedó como un pedido nuevo.',
      pt: 'O assistente usa no máximo 8 ferramentas por pedido (ler chats, buscar, preparar pastas). Quando chega a esse limite, ele para de usar ferramentas e conta o que fez, o que espera a sua confirmação e o que falta. Abaixo da resposta, um aviso mostra que chegou ao limite, com um botão Continuar que retoma de onde parou como um novo pedido.',
    },
  ],
} satisfies ChangelogEntry;
