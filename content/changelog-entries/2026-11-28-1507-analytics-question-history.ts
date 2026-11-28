import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-28-analytics-question-history',
  date: '2026-11-28',
  title: {
    en: 'Analytics: version history for questions',
    es: 'Analytics: historial de versiones de las preguntas',
    pt: 'Analytics: histórico de versões das perguntas',
  },
  items: [
    {
      product: 'analytics',
      en: 'The History button on a saved question lists each version: who saved it, when, and what changed (name, query, chart, data source, collection or description). Restore this version brings back any of the last 50, and the restore is saved as a new version, so you can undo it. Questions saved before today start their history the next time someone changes them.',
      es: 'El botón Historial de una pregunta guardada lista cada versión: quién la guardó, cuándo y qué cambió (nombre, consulta, gráfico, fuente de datos, colección o descripción). Volver a esta versión trae cualquiera de las últimas 50, y volver se guarda como una versión nueva, así que se puede deshacer. Las preguntas guardadas antes de hoy arrancan su historial la próxima vez que alguien las cambie.',
      pt: 'O botão Histórico de uma pergunta salva lista cada versão: quem salvou, quando e o que mudou (nome, consulta, gráfico, fonte de dados, coleção ou descrição). Voltar a esta versão traz qualquer uma das últimas 50, e voltar é salvo como uma versão nova, então dá para desfazer. As perguntas salvas antes de hoje começam o histórico na próxima vez que alguém mudá-las.',
    },
  ],
} satisfies ChangelogEntry;
