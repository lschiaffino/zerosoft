import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-1703-forms-redirect-answers',
  date: '2026-11-23',
  title: {
    en: 'Forms can send the answers to the page that comes next',
    es: 'Forms puede pasar las respuestas a la página que sigue',
    pt: 'O Forms pode passar as respostas para a página seguinte',
  },
  items: [
    {
      product: 'forms',
      en: 'The redirect address of an ending now takes answers with {{ref}}, for example https://cal.example.com/demo?email={{email}}. Answers, hidden fields and the score go URL encoded, so you can prefill a booking, a payment or a signup page with what someone just answered. They only fill the path and the parameters, never the domain.',
      es: 'La dirección de redirección de un final ahora acepta respuestas con {{ref}}, por ejemplo https://cal.example.com/demo?email={{email}}. Las respuestas, los campos ocultos y el puntaje van codificados para la URL, así que podés precargar una reserva, un pago o un registro con lo que la persona acaba de responder. Solo completan la ruta y los parámetros, nunca el dominio.',
      pt: 'O endereço de redirecionamento de um final agora aceita respostas com {{ref}}, por exemplo https://cal.example.com/demo?email={{email}}. As respostas, os campos ocultos e a pontuação vão codificados para a URL, então dá para preencher uma reserva, um pagamento ou um cadastro com o que a pessoa acabou de responder. Eles só preenchem o caminho e os parâmetros, nunca o domínio.',
    },
  ],
} satisfies ChangelogEntry;
