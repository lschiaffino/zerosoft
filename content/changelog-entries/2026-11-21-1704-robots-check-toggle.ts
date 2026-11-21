import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-robots-check-toggle',
  date: '2026-11-21',
  title: {
    en: 'Robots: the Check or uncheck step can switch the current state',
    es: 'Robots: el paso Marcar o desmarcar puede cambiar el estado actual',
    pt: 'Robots: o passo Marcar ou desmarcar pode alternar o estado atual',
  },
  items: [
    {
      product: 'robots',
      en: 'Besides Checked and Unchecked, the step has Switch it (one click), like Toggle in UiPath. It is for switches a site draws as its own button, where the robot cannot tell the state before acting. The run log shows how it ended (✓ or ✗) when the page says so.',
      es: 'Además de Marcado y Desmarcado, el paso tiene Cambiarla (un clic), como Toggle en UiPath. Sirve para los switches que un sitio dibuja como botón propio, donde el robot no puede saber el estado antes de actuar. El registro de la corrida muestra cómo quedó (✓ o ✗) cuando la página lo dice.',
      pt: 'Além de Marcado e Desmarcado, o passo tem Alternar (um clique), como o Toggle do UiPath. Serve para os switches que um site desenha como botão próprio, onde o robô não consegue saber o estado antes de agir. O registro da execução mostra como ficou (✓ ou ✗) quando a página informa.',
    },
  ],
} satisfies ChangelogEntry;
