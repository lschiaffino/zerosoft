/**
 * Labels compartidos por la edición rápida de Track (quick-create, modal,
 * editores inline, My tasks). Se arman en el server con `buildTrackUiLabels`
 * y se pasan a los componentes cliente.
 */
import type { IssuePriority } from '@/lib/track-tasks';

export interface TrackUiLabels {
  priorities: Array<{ value: IssuePriority; label: string }>;
  noAssignee: string;
  quick: {
    newTask: string;
    placeholder: string;
    hint: string;
    project: string;
  };
  modal: {
    title: string;
    subTitle: string;
    titlePlaceholder: string;
    descriptionPlaceholder: string;
    project: string;
    status: string;
    priority: string;
    assignee: string;
    dueDate: string;
    create: string;
    createMore: string;
    cancel: string;
    submitHint: string;
    shortcutHint: string;
  };
  inline: {
    markDone: string;
    markOpen: string;
    noDoneStatus: string;
    saveError: string;
    createError: string;
    status: string;
    priority: string;
    assignee: string;
    dueDate: string;
    noDate: string;
    today: string;
    tomorrow: string;
    nextWeek: string;
    clear: string;
    pickDate: string;
    dragHint: string;
    dismiss: string;
  };
}

type T = (key: string) => string;

export function buildTrackUiLabels(t: T): TrackUiLabels {
  return {
    priorities: [
      { value: 'urgent', label: t('priorities.urgent') },
      { value: 'high', label: t('priorities.high') },
      { value: 'medium', label: t('priorities.medium') },
      { value: 'low', label: t('priorities.low') },
    ],
    noAssignee: t('issues.noAssignee'),
    quick: {
      newTask: t('quick.newTask'),
      placeholder: t('quick.placeholder'),
      hint: t('quick.hint'),
      project: t('quick.project'),
    },
    modal: {
      title: t('quick.modalTitle'),
      subTitle: t('quick.subModalTitle'),
      titlePlaceholder: t('quick.titlePlaceholder'),
      descriptionPlaceholder: t('quick.descriptionPlaceholder'),
      project: t('quick.project'),
      status: t('issues.status'),
      priority: t('issues.priority'),
      assignee: t('issues.assignee'),
      dueDate: t('issues.dueDate'),
      create: t('quick.create'),
      createMore: t('quick.createMore'),
      cancel: t('common.cancel'),
      submitHint: t('quick.submitHint'),
      shortcutHint: t('quick.shortcutHint'),
    },
    inline: {
      markDone: t('inline.markDone'),
      markOpen: t('inline.markOpen'),
      noDoneStatus: t('inline.noDoneStatus'),
      saveError: t('inline.saveError'),
      createError: t('inline.createError'),
      status: t('issues.status'),
      priority: t('issues.priority'),
      assignee: t('issues.assignee'),
      dueDate: t('issues.dueDate'),
      noDate: t('inline.noDate'),
      today: t('inline.today'),
      tomorrow: t('inline.tomorrow'),
      nextWeek: t('inline.nextWeek'),
      clear: t('inline.clear'),
      pickDate: t('inline.pickDate'),
      dragHint: t('inline.dragHint'),
      dismiss: t('inline.dismiss'),
    },
  };
}
