import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Lo que devuelve la app: la API key queda en el llavero del sistema y no llega acá. */
interface PublicConfig {
  server: string;
  shortcut: string;
  context: string;
  has_key: boolean;
}

interface Status {
  dictating: boolean;
  meeting: string | null;
  last_text: string;
  message: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function render(s: Status) {
  $('status').textContent = s.dictating ? 'Listening…' : s.message || (s.meeting ? 'Recording the meeting' : 'Ready');
  $('last').textContent = s.last_text ? `Last: ${s.last_text}` : '';
  $<HTMLButtonElement>('start').disabled = !!s.meeting;
  $<HTMLButtonElement>('stop').disabled = !s.meeting;
}

async function init() {
  const cfg = await invoke<PublicConfig>('get_config');
  const form = $<HTMLFormElement>('config');
  for (const k of ['server', 'shortcut', 'context'] as const) {
    const el = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = cfg[k];
  }
  const keyInput = form.elements.namedItem('api_key') as HTMLInputElement;
  keyInput.required = !cfg.has_key;
  if (cfg.has_key) keyInput.placeholder = 'Saved in the system keychain (leave empty to keep it)';
  $('shortcut-label').textContent = cfg.shortcut;
  render(await invoke<Status>('get_status'));
  await listen<Status>('voice://status', (e) => render(e.payload));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const next = {
      server: String(data.get('server') ?? '').trim(),
      api_key: String(data.get('api_key') ?? '').trim() || null,
      shortcut: String(data.get('shortcut') ?? '').trim(),
      context: String(data.get('context') ?? 'other'),
    };
    $('config-error').textContent = '';
    try {
      await invoke('save_config', { input: next });
      keyInput.value = '';
      keyInput.required = false;
      keyInput.placeholder = 'Saved in the system keychain (leave empty to keep it)';
      $('shortcut-label').textContent = next.shortcut;
      $('status').textContent = 'Connected';
    } catch (err) {
      $('config-error').textContent = String(err);
    }
  });

  $('start').addEventListener('click', async () => {
    try {
      await invoke('start_meeting', { title: $<HTMLInputElement>('meeting-title').value });
    } catch (err) {
      $('status').textContent = String(err);
    }
  });
  $('stop').addEventListener('click', () => void invoke('stop_meeting'));
  $('copy-last').addEventListener('click', () => void invoke('copy_last'));
}

void init();
