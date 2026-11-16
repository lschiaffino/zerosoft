import type { ChangelogEntry } from "../changelog";

export default {
  id: "2026-11-16-when-picker-v2",
  date: "2026-11-16",
  title: {
    en: "Inbox and Lines: send later and snooze offer times that fit the moment, and a calendar to pick your own",
    es: "Inbox y Lines: enviar más tarde y posponer ofrecen horarios según el momento, y un calendario para elegir el tuyo",
    pt: "Inbox e Lines: enviar mais tarde e adiar oferecem horários conforme o momento, e um calendário para escolher o seu",
  },
  items: [
    {
      product: "inbox",
      en: "The options change with the day and the hour: Later today while it still lands before 7 p.m., Tomorrow morning and Tomorrow afternoon, In two days, Midweek, Friday afternoon, Monday morning from Thursday on, and Next week early in the week. Sending later uses working hours (9:00 and 14:00) and skips weekends; snoozing keeps This evening and This weekend. After midnight, Tomorrow morning means the coming morning. Each option shows its date and time, and the number keys follow the list in order.",
      es: "Las opciones cambian con el día y la hora: Más tarde hoy mientras caiga antes de las 19, Mañana a la mañana y Mañana a la tarde, En dos días, A mitad de semana, El viernes a la tarde, El lunes a la mañana desde el jueves y La semana que viene al principio de la semana. Enviar más tarde usa horario de trabajo (9 y 14) y saltea el fin de semana; posponer mantiene Esta noche y Este fin de semana. Pasada la medianoche, Mañana a la mañana es la mañana que viene. Cada opción muestra su día y hora, y los números del teclado siguen la lista en orden.",
      pt: "As opções mudam com o dia e a hora: Mais tarde hoje enquanto cair antes das 19h, Amanhã de manhã e Amanhã à tarde, Em dois dias, No meio da semana, Sexta à tarde, Segunda de manhã a partir de quinta e Na semana que vem no começo da semana. Enviar mais tarde usa horário comercial (9h e 14h) e pula o fim de semana; adiar mantém Hoje à noite e Neste fim de semana. Depois da meia-noite, Amanhã de manhã é a manhã que vem. Cada opção mostra o dia e a hora, e as teclas de número seguem a lista em ordem.",
    },
    {
      product: "inbox",
      en: "Pick a date and time opens a month calendar and a time field in the same window. Type the time as you say it (9, 9:30, 21 or 9pm) or tap a common one, see the full date with your time zone, and confirm with one button. It works with the keyboard (arrows move the day, Page Up and Page Down the month) and on the phone. The last time you picked by hand comes back as a suggestion.",
      es: "Elegir día y hora abre un calendario del mes y un campo de hora en la misma ventana. Escribí la hora como la decís (9, 9:30, 21 o 9pm) o tocá una de las comunes, mirá la fecha completa con tu zona horaria y confirmá con un botón. Funciona con el teclado (las flechas mueven el día, Re Pág y Av Pág el mes) y en el teléfono. La última hora que elegiste a mano vuelve como sugerencia.",
      pt: "Escolher dia e hora abre um calendário do mês e um campo de hora na mesma janela. Digite a hora como você fala (9, 9:30, 21 ou 9pm) ou toque em uma das comuns, veja a data completa com o seu fuso horário e confirme com um botão. Funciona com o teclado (as setas movem o dia, Page Up e Page Down o mês) e no celular. A última hora escolhida à mão volta como sugestão.",
    },
    {
      product: "groups",
      en: "Send later, voice notes sent later, Change time and Snooze in Lines use the same options and the same calendar.",
      es: "Enviar más tarde, las notas de voz programadas, Cambiar hora y Posponer en Lines usan las mismas opciones y el mismo calendario.",
      pt: "Enviar mais tarde, as notas de voz agendadas, Mudar horário e Adiar no Lines usam as mesmas opções e o mesmo calendário.",
    },
  ],
} satisfies ChangelogEntry;
