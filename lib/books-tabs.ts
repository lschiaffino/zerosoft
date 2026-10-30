/**
 * Books: pestañas de Ajustes (?tab=) e informes. Viven acá (sin 'use client')
 * porque las lee la página del servidor: un valor exportado de un módulo de
 * cliente llega al servidor como referencia de cliente y rompe en producción.
 */
export const SETTINGS_TABS = ['company', 'taxes', 'series', 'reminders', 'payments', 'einvoice', 'roles', 'integrations', 'audit'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function booksSettingsTab(tab: string | undefined): SettingsTab {
  return tab && (SETTINGS_TABS as readonly string[]).includes(tab) ? (tab as SettingsTab) : 'company';
}

export const REPORT_KINDS = ['pnl', 'balance-sheet', 'cash-flow', 'aged-receivables', 'aged-payables', 'tax'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
