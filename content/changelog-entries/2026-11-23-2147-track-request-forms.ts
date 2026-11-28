import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-track-request-forms',
  date: '2026-11-23',
  title: {
    en: 'Track: request forms',
    es: 'Track: formularios de pedidos',
    pt: 'Track: formulários de pedidos',
  },
  items: [
    {
      product: 'track',
      en: 'Add fields to an issue template and it becomes a request form, like form templates in Linear: short text, long text, options and checkboxes, each optional or required, with help text. Anyone who can see the team fills it in from its link, from Track › Request forms or by picking it in quick create. Each answer creates an issue with the questions and answers in its description and the template\'s priority, assignee, labels and estimate; when the team uses triage it waits there, and triage rules can match issues that came from a form. Whoever sent it is subscribed to the issue.',
      es: 'Sumá campos a una plantilla de issue y se vuelve un formulario de pedidos, como las form templates de Linear: texto corto, texto largo, opciones y casillas, cada uno opcional u obligatorio, con texto de ayuda. Quien ve el team lo completa desde su link, desde Track › Formularios de pedidos o eligiéndolo en el alta rápida. Cada respuesta crea un issue con las preguntas y respuestas en la descripción y la prioridad, el asignado, las etiquetas y la estimación de la plantilla; si el team usa triage, espera ahí, y las reglas de triage pueden apuntar a los issues que vinieron de un formulario. Quien lo mandó queda suscripto al issue.',
      pt: 'Adicione campos a um modelo de issue e ele vira um formulário de pedidos, como as form templates do Linear: texto curto, texto longo, opções e caixas de seleção, cada um opcional ou obrigatório, com texto de ajuda. Quem vê o team o preenche pelo link, por Track › Formulários de pedidos ou escolhendo-o na criação rápida. Cada resposta cria um issue com as perguntas e respostas na descrição e a prioridade, o responsável, as etiquetas e a estimativa do modelo; se o team usa triagem, ele espera lá, e as regras de triagem podem pegar os issues que vieram de um formulário. Quem enviou fica inscrito no issue.',
    },
  ],
} satisfies ChangelogEntry;
