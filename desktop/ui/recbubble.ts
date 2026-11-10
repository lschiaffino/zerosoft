/**
 * Burbuja de la cámara de Rec: la cara, redonda y en espejo, encima de todas las apps. Se arrastra
 * a cualquier lado; al pasar el mouse, Agrandar o Achicar y Ocultar. La captura de pantalla la
 * graba tal cual (la página deja de dibujar la cara en el video mientras está).
 *
 * Abre la cámara ella misma (la que eligió la página, por nombre: los ids de dispositivo cambian
 * con el origen). Si no puede, avisa `bubble-failed` y la página vuelve a dibujar la cara.
 * Escondida suelta la cámara.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface RecView {
  camera: boolean;
  bubbleVisible: boolean;
  bubbleLarge: boolean;
}

const video = document.getElementById('video') as HTMLVideoElement;
const sizeBtn = document.getElementById('size') as HTMLButtonElement;
const hideBtn = document.getElementById('hide') as HTMLButtonElement;
let strings: Record<string, string> = {};
let cameraLabel = '';
let stream: MediaStream | null = null;
let opening = false;
let want = false;
const s = (k: string) => strings[k] ?? k;
const act = (action: 'bubble-size' | 'bubble-hide' | 'bubble-failed') => void invoke('rec_overlay_action', { action });

function release() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  document.body.dataset.ready = 'false';
}

async function open() {
  if (stream || opening) return;
  opening = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    const constraints = (deviceId?: string): MediaStreamConstraints => ({
      audio: false,
      video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 640 }, height: { ideal: 640 }, frameRate: { ideal: 30 } },
    });
    let s1 = await navigator.mediaDevices.getUserMedia(constraints());
    if (cameraLabel && s1.getVideoTracks()[0]?.label !== cameraLabel) {
      const match = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'videoinput' && d.label === cameraLabel);
      if (match) {
        s1.getTracks().forEach((t) => t.stop());
        s1 = await navigator.mediaDevices.getUserMedia(constraints(match.deviceId));
      }
    }
    if (!want) {
      s1.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = s1;
    video.srcObject = s1;
    await video.play().catch(() => undefined);
    document.body.dataset.ready = 'true';
  } catch {
    release();
    act('bubble-failed');
  } finally {
    opening = false;
  }
}

function paint(v: RecView | null) {
  want = !!v && v.camera && v.bubbleVisible;
  if (want) void open();
  else release();
  const large = !!v?.bubbleLarge;
  (document.getElementById('grow') as unknown as SVGElement).style.display = large ? 'none' : '';
  (document.getElementById('shrink') as unknown as SVGElement).style.display = large ? '' : 'none';
  const sizeLabel = s(large ? 'recSmaller' : 'recBigger');
  sizeBtn.setAttribute('aria-label', sizeLabel);
  sizeBtn.title = sizeLabel;
}

sizeBtn.addEventListener('click', () => act('bubble-size'));
hideBtn.addEventListener('click', () => act('bubble-hide'));

// Arrastrar la burbuja desde la cara.
document.getElementById('face')!.addEventListener('mousedown', (e) => {
  if (e.button === 0) void getCurrentWindow().startDragging();
});

void listen<RecView | null>('rec://state', (e) => paint(e.payload));
void invoke<{ view: RecView | null; cameraLabel: string | null; strings: Record<string, string> }>('rec_overlay_state').then((v) => {
  strings = v.strings;
  cameraLabel = v.cameraLabel ?? '';
  document.documentElement.lang = strings.lang ?? document.documentElement.lang;
  const face = document.getElementById('face')!;
  face.setAttribute('aria-label', s('recBubble'));
  face.title = s('recBubble');
  hideBtn.setAttribute('aria-label', s('recHideCamera'));
  hideBtn.title = s('recHideCamera');
  paint(v.view);
});
