'use client';

/**
 * Talk: cliente de huddles. Malla WebRTC (una RTCPeerConnection por cada otra
 * pestaña del huddle), con señalización por /api/talk/huddles y el feed de
 * Talk (eventos 'signal' dirigidos a esta persona).
 *
 * - Quien entra le ofrece a cada uno de los que ya estaban; si una conexión
 *   falta o se cae, la reconciliación del latido la rehace (ofrece el de id
 *   menor). Choque de ofertas: el de id mayor cede ("polite peer").
 * - ICE sin trickle: se espera a juntar candidatos (hasta ICE_WAIT_MS) y se
 *   manda una sola oferta / respuesta, así la señalización son dos mensajes.
 * - Pantalla y cámara van por dos transceivers de video creados de entrada por
 *   quien ofrece (orden fijo: pantalla, cámara): prender o apagar es
 *   replaceTrack, sin renegociar. Quien responde toma los que crea la oferta y
 *   los pasa a sendrecv: un addTransceiver propio no se asocia a la oferta
 *   (JSEP) y lo que mandara por ahí nunca llegaría.
 * - La cámara sale en 360p a 15 cuadros y con tope de bitrate: en malla, cada
 *   persona sube una copia por cada otra.
 */
import type { HuddleDto, IceServer } from '@/lib/talk-huddles';

const ICE_WAIT_MS = 2500;
const BEAT_MS = 15_000;
const CAMERA_CONSTRAINTS: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 15 } };
const CAMERA_MAX_BITRATE = 350_000;

type Api = <T>(url: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

interface PeerConn {
  peerId: string;
  userId: string;
  pc: RTCPeerConnection;
  /** Pantalla compartida. */
  video: RTCRtpSender | null;
  cameraSender: RTCRtpSender | null;
  audioEl: HTMLAudioElement | null;
  screen: MediaStream | null;
  camera: MediaStream | null;
  level: number;
  analyser: AnalyserNode | null;
  createdAt: number;
}

export interface HuddleView {
  status: 'joining' | 'live' | 'error';
  error: string | null;
  huddle: HuddleDto | null;
  channelId: string;
  peerId: string;
  muted: boolean;
  sharing: boolean;
  /** Mi cámara está prendida. */
  cameraOn: boolean;
  /** Pidiendo o soltando la cámara: el botón espera. */
  cameraBusy: boolean;
  micMissing: boolean;
  turn: boolean;
  /** Estado de la conexión con cada otra pestaña. */
  links: Record<string, RTCPeerConnectionState>;
  speaking: string[];
  screens: Array<{ peerId: string; userId: string; stream: MediaStream }>;
  localScreen: MediaStream | null;
  cameras: Array<{ peerId: string; userId: string; stream: MediaStream }>;
  localCamera: MediaStream | null;
}

function newPeerId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, ICE_WAIT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export class HuddleSession {
  readonly peerId = newPeerId();
  private peers = new Map<string, PeerConn>();
  private ice: IceServer[] = [];
  private mic: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private sharePending = false;
  private beatTimer: ReturnType<typeof setInterval> | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private audioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private closed = false;
  view: HuddleView;

  constructor(
    private api: Api,
    channelId: string,
    private onChange: (v: HuddleView) => void,
  ) {
    this.view = {
      status: 'joining',
      error: null,
      huddle: null,
      channelId,
      peerId: this.peerId,
      muted: false,
      sharing: false,
      micMissing: false,
      turn: false,
      links: {},
      speaking: [],
      screens: [],
      localScreen: null,
      cameraOn: false,
      cameraBusy: false,
      cameras: [],
      localCamera: null,
    };
  }

  private emit(patch: Partial<HuddleView> = {}) {
    this.view = { ...this.view, ...patch };
    this.onChange(this.view);
  }

  async join(): Promise<void> {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch {
      // Sin micrófono (o sin permiso) igual se entra a escuchar.
      this.mic = null;
    }
    if (this.closed) return this.stopTracks();
    try {
      const res = await this.api<{ huddle: HuddleDto; iceServers: IceServer[]; turn: boolean }>('/api/talk/huddles', {
        method: 'POST',
        json: { action: 'join', channelId: this.view.channelId, peerId: this.peerId },
      });
      if (this.closed) {
        void this.api('/api/talk/huddles', { method: 'POST', json: { action: 'leave', huddleId: res.huddle.id, peerId: this.peerId } }).catch(() => undefined);
        return this.stopTracks();
      }
      this.ice = res.iceServers;
      this.emit({ status: 'live', huddle: res.huddle, micMissing: !this.mic, muted: !this.mic, turn: res.turn });
      this.watchLevels();
      for (const p of res.huddle.peers) if (p.peerId !== this.peerId) void this.offer(p.peerId, p.userId);
      this.beatTimer = setInterval(() => void this.beat(), BEAT_MS);
    } catch (err) {
      this.stopTracks();
      this.emit({ status: 'error', error: (err as { code?: string })?.code ?? 'huddle_failed' });
    }
  }

  /** Los senders de video según el orden de los transceivers: [pantalla, cámara]. */
  private bindVideo(conn: PeerConn) {
    const videos = conn.pc.getTransceivers().filter((t) => t.receiver.track.kind === 'video');
    conn.video = videos[0]?.sender ?? null;
    conn.cameraSender = videos[1]?.sender ?? null;
    for (const t of videos) if (t.direction !== 'sendrecv') t.direction = 'sendrecv';
    const screenTrack = this.screenStream?.getVideoTracks()[0];
    if (screenTrack) void conn.video?.replaceTrack(screenTrack).catch(() => undefined);
    const cameraTrack = this.cameraStream?.getVideoTracks()[0];
    if (cameraTrack) {
      void conn.cameraSender?.replaceTrack(cameraTrack).catch(() => undefined);
      this.capCamera(conn);
    }
  }

  private capCamera(conn: PeerConn) {
    const sender = conn.cameraSender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return; // Todavía sin negociar: se aplica el tope al conectar.
    params.encodings[0].maxBitrate = CAMERA_MAX_BITRATE;
    void sender.setParameters(params).catch(() => undefined);
  }

  private newConn(peerId: string, userId: string, role: 'offer' | 'answer' = 'offer'): PeerConn {
    this.peers.get(peerId)?.pc.close();
    const pc = new RTCPeerConnection({ iceServers: this.ice as RTCIceServer[] });
    const conn: PeerConn = { peerId, userId, pc, video: null, cameraSender: null, audioEl: null, screen: null, camera: null, level: 0, analyser: null, createdAt: Date.now() };
    const track = this.mic?.getAudioTracks()[0];
    if (track) pc.addTrack(track, this.mic!);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    if (role === 'offer') {
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      this.bindVideo(conn);
    }
    pc.ontrack = (e) => {
      if (e.track.kind === 'audio') {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        if (!conn.audioEl) {
          conn.audioEl = document.createElement('audio');
          conn.audioEl.autoplay = true;
          conn.audioEl.dataset.huddlePeer = peerId;
          document.body.appendChild(conn.audioEl);
        }
        conn.audioEl.srcObject = stream;
        void conn.audioEl.play().catch(() => undefined);
        conn.analyser = this.analyse(stream);
      } else {
        // El orden de los transceivers dice qué es: el primero la pantalla, el segundo la cámara.
        const index = pc.getTransceivers().filter((t) => t.receiver.track.kind === 'video').indexOf(e.transceiver);
        if (index === 1) conn.camera = new MediaStream([e.track]);
        else conn.screen = new MediaStream([e.track]);
        e.track.onunmute = () => this.syncScreens();
        e.track.onmute = () => this.syncScreens();
        this.syncScreens();
      }
    };
    pc.onconnectionstatechange = () => {
      this.emit({ links: { ...this.view.links, [peerId]: pc.connectionState } });
      if (pc.connectionState === 'connected' && this.cameraStream) this.capCamera(conn);
      if (pc.connectionState === 'failed' && this.peerId < peerId) void this.offer(peerId, userId);
    };
    this.peers.set(peerId, conn);
    this.emit({ links: { ...this.view.links, [peerId]: pc.connectionState } });
    return conn;
  }

  private async send(to: string, data: unknown) {
    const huddleId = this.view.huddle?.id;
    if (!huddleId) return;
    await this.api('/api/talk/huddles', { method: 'POST', json: { action: 'signal', huddleId, peerId: this.peerId, to, data } }).catch(() => undefined);
  }

  private async offer(peerId: string, userId: string) {
    if (this.closed) return;
    const conn = this.newConn(peerId, userId);
    const offer = await conn.pc.createOffer();
    await conn.pc.setLocalDescription(offer);
    await waitIce(conn.pc);
    if (this.closed || this.peers.get(peerId) !== conn) return;
    await this.send(peerId, { type: 'offer', sdp: conn.pc.localDescription?.sdp, userId: '' });
  }

  /** Señal de otra pestaña (evento 'signal' del feed). */
  async onSignal(p: { huddleId?: string; from?: string; to?: string; data?: { type?: string; sdp?: string } }, fromUser: string | null) {
    if (this.closed || !p.from || p.to !== this.peerId || p.huddleId !== this.view.huddle?.id || !p.data?.sdp) return;
    const from = p.from;
    if (p.data.type === 'offer') {
      const existing = this.peers.get(from);
      // Choque: los dos ofrecimos. Cede el de id mayor.
      if (existing && existing.pc.signalingState === 'have-local-offer' && this.peerId < from) return;
      const conn = this.newConn(from, fromUser ?? existing?.userId ?? '', 'answer');
      await conn.pc.setRemoteDescription({ type: 'offer', sdp: p.data.sdp });
      this.bindVideo(conn);
      const answer = await conn.pc.createAnswer();
      await conn.pc.setLocalDescription(answer);
      await waitIce(conn.pc);
      if (this.closed || this.peers.get(from) !== conn) return;
      await this.send(from, { type: 'answer', sdp: conn.pc.localDescription?.sdp });
    } else if (p.data.type === 'answer') {
      const conn = this.peers.get(from);
      if (conn && conn.pc.signalingState === 'have-local-offer') await conn.pc.setRemoteDescription({ type: 'answer', sdp: p.data.sdp }).catch(() => undefined);
    }
  }

  /** Evento 'huddle' del feed (alguien entró, salió, cambió su estado o terminó). */
  onHuddleEvent(p: { huddleId?: string; change?: string; peerId?: string }) {
    if (this.closed || p.huddleId !== this.view.huddle?.id) return;
    if (p.change === 'ended') return void this.leave(false);
    if (p.change === 'left' && p.peerId) {
      if (p.peerId === this.peerId) return void this.leave(false);
      this.dropPeer(p.peerId);
    }
    void this.beat();
  }

  private dropPeer(peerId: string) {
    const c = this.peers.get(peerId);
    if (!c) return;
    c.pc.close();
    c.audioEl?.remove();
    this.peers.delete(peerId);
    const links = { ...this.view.links };
    delete links[peerId];
    this.emit({ links });
    this.syncScreens();
  }

  private beating = false;
  private async beat() {
    const huddleId = this.view.huddle?.id;
    if (!huddleId || this.closed || this.beating) return;
    this.beating = true;
    try {
      const res = await this.api<{ huddle: HuddleDto }>('/api/talk/huddles', {
        method: 'POST',
        json: { action: 'beat', huddleId, peerId: this.peerId, state: { muted: this.view.muted, sharing: this.view.sharing, video: this.view.cameraOn } },
      });
      if (this.closed) return;
      this.emit({ huddle: res.huddle });
      this.syncScreens();
      // Reconciliación: fuera las conexiones con pestañas que ya no están; las que faltan, las ofrece el de id menor.
      const live = new Set(res.huddle.peers.map((p) => p.peerId));
      for (const id of [...this.peers.keys()]) if (!live.has(id)) this.dropPeer(id);
      for (const p of res.huddle.peers) {
        if (p.peerId === this.peerId) continue;
        const c = this.peers.get(p.peerId);
        const stale = c && (c.pc.connectionState === 'failed' || c.pc.connectionState === 'closed' || (c.pc.connectionState !== 'connected' && Date.now() - c.createdAt > 15_000));
        if ((!c || stale) && this.peerId < p.peerId) void this.offer(p.peerId, p.userId);
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'huddle_ended' || code === 'not_found') void this.leave(false);
    } finally {
      this.beating = false;
    }
  }

  setMuted(muted: boolean) {
    if (!this.mic) return;
    for (const t of this.mic.getAudioTracks()) t.enabled = !muted;
    this.emit({ muted });
    void this.beat();
  }

  async share(): Promise<void> {
    if (this.view.sharing) return this.stopShare();
    if (this.sharePending || this.closed) return;
    this.sharePending = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return;
    } finally {
      this.sharePending = false;
    }
    const track = stream.getVideoTracks()[0];
    if (!track || this.closed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.screenStream = stream;
    track.onended = () => void this.stopShare();
    for (const c of this.peers.values()) await c.video?.replaceTrack(track).catch(() => undefined);
    this.emit({ sharing: true, localScreen: stream });
    void this.beat();
  }

  async stopShare(): Promise<void> {
    for (const c of this.peers.values()) await c.video?.replaceTrack(null).catch(() => undefined);
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.emit({ sharing: false, localScreen: null });
    void this.beat();
  }

  /** Prende o apaga mi cámara. Devuelve un código de error si no se pudo. */
  async toggleCamera(): Promise<string | null> {
    // Un doble clic no pide dos veces: el segundo stream quedaría prendido sin nadie que lo apague.
    if (this.view.cameraBusy || this.closed) return null;
    this.emit({ cameraBusy: true });
    try {
      if (this.view.cameraOn) {
        await this.stopCamera();
        return null;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS, audio: false });
      } catch {
        return this.closed ? null : 'camera_unavailable';
      }
      // Salió del huddle mientras el navegador pedía el permiso.
      if (this.closed) {
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        return 'camera_unavailable';
      }
      this.cameraStream = stream;
      track.onended = () => void this.stopCamera();
      for (const c of this.peers.values()) {
        await c.cameraSender?.replaceTrack(track).catch(() => undefined);
        this.capCamera(c);
      }
      this.emit({ cameraOn: true, localCamera: stream });
      void this.beat();
      return null;
    } finally {
      if (!this.closed) this.emit({ cameraBusy: false });
    }
  }

  async stopCamera(): Promise<void> {
    for (const c of this.peers.values()) await c.cameraSender?.replaceTrack(null).catch(() => undefined);
    // Se apaga el dispositivo (la luz de la cámara), no solo el envío.
    this.cameraStream?.getTracks().forEach((t) => t.stop());
    this.cameraStream = null;
    this.emit({ cameraOn: false, localCamera: null });
    void this.beat();
  }

  private syncScreens() {
    const peers = this.view.huddle?.peers ?? [];
    const sharing = new Set(peers.filter((p) => p.sharing).map((p) => p.peerId));
    const filming = new Set(peers.filter((p) => p.video).map((p) => p.peerId));
    const live = (s: MediaStream | null) => !!s && s.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);
    const conns = [...this.peers.values()];
    // Lo manda el estado del huddle: un track apagado no siempre queda "muted" del otro lado.
    const screens = conns.filter((c) => live(c.screen) && sharing.has(c.peerId)).map((c) => ({ peerId: c.peerId, userId: c.userId, stream: c.screen! }));
    const cameras = conns.filter((c) => live(c.camera) && filming.has(c.peerId)).map((c) => ({ peerId: c.peerId, userId: c.userId, stream: c.camera! }));
    // Solo si cambió (el medidor de voz llama cada 300 ms: no re-renderiza de más).
    const keyOf = (list: Array<{ peerId: string; stream: MediaStream }>) => list.map((x) => `${x.peerId}:${x.stream.id}`).join();
    if (keyOf(screens) === keyOf(this.view.screens) && keyOf(cameras) === keyOf(this.view.cameras)) return;
    this.emit({ screens, cameras });
  }

  private analyse(stream: MediaStream): AnalyserNode | null {
    try {
      this.audioCtx ??= new AudioContext();
      const src = this.audioCtx.createMediaStreamSource(stream);
      const a = this.audioCtx.createAnalyser();
      a.fftSize = 512;
      src.connect(a);
      return a;
    } catch {
      return null;
    }
  }

  private watchLevels() {
    if (this.mic) this.localAnalyser = this.analyse(this.mic);
    const buf = new Uint8Array(512);
    const level = (a: AnalyserNode | null) => {
      if (!a) return 0;
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) * (v - 128);
      return Math.sqrt(sum / buf.length);
    };
    this.levelTimer = setInterval(() => {
      const speaking: string[] = [];
      if (!this.view.muted && level(this.localAnalyser) > 6) speaking.push(this.peerId);
      for (const c of this.peers.values()) if (level(c.analyser) > 6) speaking.push(c.peerId);
      if (speaking.join() !== this.view.speaking.join()) this.emit({ speaking });
      this.syncScreens();
    }, 300);
  }

  private stopTracks() {
    this.mic?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.cameraStream?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.screenStream = null;
    this.cameraStream = null;
  }

  async leave(notify = true): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.beatTimer) clearInterval(this.beatTimer);
    if (this.levelTimer) clearInterval(this.levelTimer);
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.stopTracks();
    void this.audioCtx?.close().catch(() => undefined);
    const huddleId = this.view.huddle?.id;
    if (notify && huddleId) {
      await this.api('/api/talk/huddles', { method: 'POST', json: { action: 'leave', huddleId, peerId: this.peerId } }).catch(() => undefined);
    }
    this.emit({ status: 'error', error: null, huddle: null, screens: [], localScreen: null, cameras: [], localCamera: null, cameraOn: false, cameraBusy: false });
  }

  /** Al cerrar la pestaña: salida inmediata (sin esperar al barrido). */
  leaveBeacon() {
    const huddleId = this.view.huddle?.id;
    if (!huddleId || this.closed) return;
    try {
      navigator.sendBeacon('/api/talk/huddles', new Blob([JSON.stringify({ action: 'leave', huddleId, peerId: this.peerId })], { type: 'application/json' }));
    } catch {
      /* el barrido lo saca igual */
    }
  }
}
