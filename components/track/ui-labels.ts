/**
 * Labels compartidos por la edición rápida de Track (quick-create, modal,
 * editores inline, My tasks). Se arman en el server con `buildTrackUiLabels`
 * y se pasan a los componentes cliente.
 */
import type { IssuePriority } from '@/lib/track-tasks';
import type { MarkdownLabels } from './MarkdownEditor';
import type { DisplayLabels } from './IssueDisplayOptions';

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
    cycle: string;
    noCycle: string;
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
    loadError: string;
  };
  markdown: MarkdownLabels;
  display: DisplayLabels & { noCycle: string; noLabel: string };
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
      cycle: t('quick.cycle'),
      noCycle: t('quick.noCycle'),
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
      loadError: t('inline.loadError'),
    },
    markdown: {
      write: t('markdown.write'),
      preview: t('markdown.preview'),
      toolbar: t('markdown.toolbar'),
      bold: t('markdown.bold'),
      italic: t('markdown.italic'),
      code: t('markdown.code'),
      list: t('markdown.list'),
      link: t('markdown.link'),
      placeholderText: t('markdown.placeholderText'),
      emptyPreview: t('markdown.emptyPreview'),
      hint: t('markdown.hint'),
    },
    display: {
      groupBy: t('display.groupBy'),
      sortBy: t('display.sortBy'),
      noCycle: t('display.noCycle'),
      noLabel: t('display.noLabel'),
      groups: {
        none: t('display.groups.none'),
        status: t('display.groups.status'),
        assignee: t('display.groups.assignee'),
        priority: t('display.groups.priority'),
        cycle: t('display.groups.cycle'),
        label: t('display.groups.label'),
        project: t('display.groups.project'),
      },
      sorts: {
        newest: t('display.sorts.newest'),
        oldest: t('display.sorts.oldest'),
        updated: t('display.sorts.updated'),
        priority: t('display.sorts.priority'),
        due: t('display.sorts.due'),
        identifier: t('display.sorts.identifier'),
        customers: t('display.sorts.customers'),
        revenue: t('display.sorts.revenue'),
      },
    },
  };
}
