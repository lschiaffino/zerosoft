import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-voice-smart-format',
  date: '2026-11-15',
  title: {
    en: 'Voice: dictated lists, punctuation and emails come out formatted',
    es: 'Voice: las listas, la puntuación y los mails dictados salen con formato',
    pt: 'Voice: listas, pontuação e e-mails ditados saem formatados',
  },
  items: [
    {
      product: 'voice',
      en: 'Say "I need a list, colon, eggs, meat and milk" and Voice pastes a bulleted list with one item per line. "Number one… number two…" gives a numbered list. Spoken punctuation becomes the symbol: "comma", "colon", "open paren", "open quote", "new paragraph", and "ana at zerosoft dot ai" becomes an address. It works in English, Spanish and Portuguese, and short dictations from the desktop app get this formatting without waiting for the AI. In an email the greeting and the sign-off you said go on their own lines; in a chat the text stays as you said it. Voice never adds a greeting you did not say.',
      es: 'Decí "Quiero una lista, dos puntos, huevo, carne y leche" y Voice pega una lista con una viñeta por cosa. "Punto uno… punto dos…" arma una lista numerada. La puntuación dicha queda como el signo: "coma", "dos puntos", "abrir paréntesis", "abrir comillas", "punto y aparte", y "juan arroba gmail punto com" queda como dirección. Anda en español, inglés y portugués, y los dictados cortos de la app de escritorio salen con este formato sin esperar a la IA. En un mail, el saludo y la despedida que dijiste van en su línea; en un chat el texto queda como lo dijiste. Voice nunca agrega un saludo que no dijiste.',
      pt: 'Diga "Quero uma lista, dois pontos, arroz, feijão e café" e o Voice cola uma lista com um item por linha. "Número um… número dois…" gera uma lista numerada. A pontuação falada vira o sinal: "vírgula", "dois pontos", "abre parênteses", "abre aspas", "novo parágrafo", e "ana arroba zerosoft ponto ai" vira um endereço. Funciona em português, espanhol e inglês, e os ditados curtos do app desktop saem com essa formatação sem esperar a IA. Num e-mail, a saudação e a despedida que você disse ficam na própria linha; num chat o texto fica como você disse. O Voice nunca adiciona uma saudação que você não disse.',
    },
  ],
} satisfies ChangelogEntry;
