'use client';

import { createContext, useContext } from 'react';
import type { TalkBootstrap } from '@/lib/talk-boot';
import type { TalkChannelDto, TalkMessageDto, TalkPerson } from '@/lib/talk';
import type { TalkPresenceDto } from '@/lib/talk-extras';

export type TalkView = 'channel' | 'threads' | 'activity' | 'later' | 'drafts' | 'files' | 'search' | 'browse';

export interface TalkCtx {
  boot: TalkBootstrap;
  locale: string;
  people: Map<string, TalkPerson>;
  presence: Map<string, TalkPresenceDto>;
  channels: TalkChannelDto[];
  channelById: Map<string, TalkChannelDto>;
  /** Nombre visible de un canal o DM (DMs: las personas). */
  channelTitle: (c: Pick<TalkChannelDto, 'kind' | 'name' | 'memberIds'>) => string;
  personName: (id: string | null | undefined) => string;
  open: (target: { channelId?: string; view?: TalkView; messageId?: string; threadId?: string | null; query?: string }) => void;
  openThread: (rootId: string | null) => void;
  refreshBoot: () => void;
  toast: (text: string, kind?: 'ok' | 'error') => void;
  api: <T = unknown>(url: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
  /** Mensajes cambiados que otros paneles tienen que refrescar. */
  patchMessage: (m: TalkMessageDto) => void;
  removeMessage: (id: string) => void;
  dialog: (d: TalkDialog | null) => void;
  typing: Map<string, Map<string, number>>;
  /** Bus para los paneles: eventos del tiempo real y cambios locales. */
  subscribe: (fn: (e: TalkBusEvent) => void) => () => void;
  drafts: Map<string, string>;
  setDraft: (channelId: string, parentId: string | null, body: string) => void;
}

export type TalkBusEvent =
  | { type: 'events'; events: import('@/lib/talk').TalkEvent[] }
  | { type: 'patch'; message: TalkMessageDto }
  | { type: 'remove'; id: string };

export const draftKey = (channelId: string, parentId: string | null) => `${channelId}|${parentId ?? ''}`;

export type TalkDialog =
  | { kind: 'create-channel' }
  | { kind: 'new-dm' }
  | { kind: 'details'; channelId: string; tab?: 'about' | 'members' | 'settings' | 'integrations' }
  | { kind: 'status' }
  | { kind: 'prefs' }
  | { kind: 'remind'; messageId: string }
  | { kind: 'schedule'; channelId: string; parentId: string | null; body: string; fileIds: string[]; onDone: () => void }
  | { kind: 'issue'; message: TalkMessageDto }
  | { kind: 'share'; onPick: (url: string) => void }
  | { kind: 'emoji'; onPick: (emoji: string) => void; anchor?: DOMRect | null }
  | { kind: 'confirm-delete-message'; messageId: string }
  | { kind: 'shortcuts' };

export const TalkContext = createContext<TalkCtx | null>(null);

export function useTalk(): TalkCtx {
  const ctx = useContext(TalkContext);
  if (!ctx) throw new Error('useTalk outside TalkApp');
  return ctx;
}

export class TalkApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export async function talkFetch<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new TalkApiError(data.error ?? `http_${res.status}`, res.status);
  }
  return (await res.json().catch(() => ({}))) as T;
}
