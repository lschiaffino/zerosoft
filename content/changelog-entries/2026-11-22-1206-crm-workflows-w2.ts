import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-1206-crm-workflows-w2',
  date: '2026-11-22',
  title: {
    en: 'CRM: workflow waits until a date, a day and time, or an event',
    es: 'CRM: esperas de workflow hasta una fecha, un día y hora o un evento',
    pt: 'CRM: esperas de workflow até uma data, um dia e hora ou um evento',
  },
  items: [
    {
      product: 'crm',
      en: 'A wait in a workflow can now last until a date (a date property of the record, like a renewal, or a day on the calendar, with days before or after and a time in your time zone), until the next chosen weekday at a time, or until something happens: an email opened, clicked or replied, a form, a meeting, a property change, a deal stage change, a won or lost deal, or an accepted quote. Event waits have a time limit, and the actions after them can run only if it happened or only if time ran out. Members with limited record visibility no longer see older enrollments of a workflow whose criteria looked at another record when the record entered, even if the criteria changed later.',
      es: 'Una espera en un workflow ahora puede durar hasta una fecha (una propiedad de fecha del registro, como una renovación, o un día del calendario, con días antes o después y una hora en tu zona horaria), hasta el próximo día de la semana que elijas a una hora, o hasta que pase algo: un email abierto, con clic o respondido, un formulario, una reunión, un cambio de propiedad, un cambio de etapa del deal, un deal ganado o perdido, o una cotización aceptada. Las esperas por evento tienen un tiempo límite, y las acciones de después pueden correr solo si pasó o solo si se venció el tiempo. Los miembros con visibilidad de registros limitada ya no ven inscripciones viejas de un workflow cuyos criterios miraban otro registro cuando el registro entró, aunque los criterios hayan cambiado después.',
      pt: 'Uma espera num workflow agora pode durar até uma data (uma propriedade de data do registro, como uma renovação, ou um dia do calendário, com dias antes ou depois e um horário no seu fuso), até o próximo dia da semana escolhido num horário, ou até algo acontecer: um email aberto, clicado ou respondido, um formulário, uma reunião, uma mudança de propriedade, uma mudança de etapa do negócio, um negócio ganho ou perdido, ou uma cotação aceita. As esperas por evento têm um tempo limite, e as ações depois delas podem rodar só se aconteceu ou só se o tempo acabou. Membros com visibilidade de registros limitada não veem mais inscrições antigas de um workflow cujos critérios olhavam outro registro quando o registro entrou, mesmo que os critérios tenham mudado depois.',
    },
  ],
} satisfies ChangelogEntry;
