import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-desktop-accessibility-restart',
  date: '2026-11-16',
  title: {
    en: 'Desktop for Mac: Accessibility keeps working after an update',
    es: 'Escritorio en Mac: Accesibilidad sigue andando después de una actualización',
    pt: 'Desktop no Mac: a Acessibilidade continua funcionando depois de uma atualização',
  },
  items: [
    {
      product: 'voice',
      en: 'The Mac app installed each new version over itself while it was open. From then until you restarted it, macOS did not recognize its Accessibility permission even with the switch on, so dictation copied the text instead of pasting it, and turning the switch on again or resetting it did not help. Version 0.3.11 downloads the update in the background and installs it when you choose Restart to update or quit the app. If the app is still replaced while it is open, for example by dragging a new copy into Applications, Settings says so and offers Restart zerosoft instead of Reset permission.',
      es: 'La app de Mac instalaba cada versión nueva encima de sí misma mientras estaba abierta. Desde ese momento y hasta reiniciarla, macOS no reconocía su permiso de Accesibilidad aunque la llave estuviera prendida: el dictado copiaba el texto en vez de pegarlo, y volver a prender la llave o restablecerla no servía. La versión 0.3.11 baja la actualización en segundo plano y la instala cuando elegís Reiniciar para actualizar o al salir de la app. Si igual la app se reemplaza estando abierta, por ejemplo arrastrando una copia nueva a Aplicaciones, Ajustes lo dice y ofrece Reiniciar zerosoft en vez de Restablecer permiso.',
      pt: 'O app de Mac instalava cada versão nova por cima de si mesmo enquanto estava aberto. A partir daí e até reiniciar, o macOS não reconhecia a permissão de Acessibilidade mesmo com a chave ligada: o ditado copiava o texto em vez de colar, e ligar a chave de novo ou redefini-la não adiantava. A versão 0.3.11 baixa a atualização em segundo plano e a instala quando você escolhe Reiniciar para atualizar ou ao sair do app. Se mesmo assim o app for substituído aberto, por exemplo arrastando uma cópia nova para Aplicativos, os Ajustes avisam e oferecem Reiniciar o zerosoft em vez de Redefinir permissão.',
    },
  ],
} satisfies ChangelogEntry;
