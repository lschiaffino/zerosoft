import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-assistant-request-links',
  date: '2026-11-19',
  title: {
    en: 'Assistant: a link to every request, and an email when it ships',
    es: 'Asistente: un link a cada pedido y un email cuando sale',
    pt: 'Assistente: um link para cada pedido e um email quando sai',
  },
  items: [
    {
      product: 'platform',
      en: 'When the assistant records something you asked for, it gives you a link to your request. The page shows what you asked for in your words and its status (received, planned, in progress, shipped), and only you and the zerosoft team can see it. All your requests are in Settings › My requests, and you can ask the assistant where a request is at any time. When something you asked for ships, you get an email with the link to the changelog.',
      es: 'Cuando el asistente anota algo que pediste, te da un link a tu pedido. La página muestra lo que pediste con tus palabras y en qué estado está (recibido, planeado, en curso, lanzado), y la ven solo vos y el equipo de zerosoft. Todos tus pedidos están en Ajustes › Mis pedidos, y le podés preguntar al asistente dónde está un pedido cuando quieras. Cuando sale algo que pediste, te llega un email con el link al changelog.',
      pt: 'Quando o assistente registra algo que você pediu, ele te dá um link para o seu pedido. A página mostra o que você pediu com as suas palavras e em que status está (recebido, planejado, em andamento, lançado), e só você e a equipe da zerosoft a veem. Todos os seus pedidos ficam em Ajustes › Meus pedidos, e você pode perguntar ao assistente onde está um pedido quando quiser. Quando sai algo que você pediu, você recebe um email com o link para o changelog.',
    },
  ],
} satisfies ChangelogEntry;
