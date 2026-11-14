import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-14-track-initiative-updates',
  date: '2026-11-14',
  title: {
    en: 'Track: updates on initiatives',
    es: 'Track: updates en las iniciativas',
    pt: 'Track: updates nas iniciativas',
  },
  items: [
    {
      product: 'track',
      en: 'An initiative now has its own updates, like a project: pick on track, at risk or off track, write what changed and post it with ⌘↵. The latest update sets the initiative health on its page, in the Initiatives list and on the roadmap. Without updates, the health is still the worst of its active projects. The owner, the person who created it and the leads of its projects get the update in their Inbox. The author can edit an update, and the author or a workspace admin can delete it.',
      es: 'Una iniciativa ahora tiene sus propios updates, como un proyecto: elegís en camino, en riesgo o desviado, escribís qué cambió y lo publicás con ⌘↵. El último update fija la salud de la iniciativa en su página, en la lista de Iniciativas y en el roadmap. Sin updates, la salud sigue siendo la peor de sus proyectos en curso. El responsable, quien la creó y los leads de sus proyectos reciben el update en su Inbox. El autor puede editar un update, y el autor o un admin del workspace lo puede borrar.',
      pt: 'Uma iniciativa agora tem seus próprios updates, como um projeto: escolha no caminho, em risco ou fora do caminho, escreva o que mudou e publique com ⌘↵. O último update define a saúde da iniciativa na sua página, na lista de Iniciativas e no roadmap. Sem updates, a saúde continua sendo a pior dos projetos em andamento. O responsável, quem a criou e os leads dos projetos recebem o update no Inbox. O autor pode editar um update, e o autor ou um admin do workspace pode apagá-lo.',
    },
  ],
} satisfies ChangelogEntry;
