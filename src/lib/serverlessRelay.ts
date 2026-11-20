import type { ClientRole, MouseCommand } from '../types/mouse';

const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeRemainingLength(len: number): number[] {
  const bytes: number[] = [];
  let value = len;
  do {
    let digit = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) digit |= 0x80;
    bytes.push(digit);
  } while (value > 0);
  return bytes;
}

function encodeUtf8String(str: string): Uint8Array<ArrayBuffer> {
  const encoded = textEncoder.encode(str);
  const out = new Uint8Array(new ArrayBuffer(2 + encoded.length));
  out[0] = (encoded.length >> 8) & 0xff;
  out[1] = encoded.length & 0xff;
  out.set(encoded, 2);
  return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

function buildMqttConnect(clientId: string): Uint8Array<ArrayBuffer> {
  const protocolName = encodeUtf8String('MQTT');
  const flags = new Uint8Array([0x04, 0x02, 0x00, 0x1e]); // MQTT 3.1.1, clean session, 30s keepalive
  const payload = encodeUtf8String(clientId);
  const variableAndPayload = concatBytes(protocolName, flags, payload);
  const header = new Uint8Array([0x10, ...encodeRemainingLength(variableAndPayload.length)]);
  return concatBytes(header, variableAndPayload);
}

function buildMqttSubscribe(packetId: number, topics: string[]): Uint8Array<ArrayBuffer> {
  const pid = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
  const parts: Uint8Array[] = [pid];
  for (const topic of topics) {
    parts.push(encodeUtf8String(topic), new Uint8Array([0x00])); // QoS 0
  }
  const body = concatBytes(...parts);
  const header = new Uint8Array([0x82, ...encodeRemainingLength(body.length)]);
  return concatBytes(header, body);
}

function buildMqttPublish(topic: string, payloadStr: string): Uint8Array<ArrayBuffer> {
  const topicBytes = encodeUtf8String(topic);
  const payloadBytes = textEncoder.encode(payloadStr);
  const body = concatBytes(topicBytes, payloadBytes);
  const header = new Uint8Array([0x30, ...encodeRemainingLength(body.length)]);
  return concatBytes(header, body);
}

function buildMqttPingReq(): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(2));
  out[0] = 0xc0;
  out[1] = 0x00;
  return out;
}

interface ParsedMqttPacket {
  type: number;
  bytesConsumed: number;
  topic?: string;
  payload?: string;
  connackCode?: number;
}

function tryParseMqttPacket(buf: Uint8Array): ParsedMqttPacket | null {
  if (buf.length < 2) return null;
  const packetType = (buf[0] >> 4) & 0x0f;
  const qos = (buf[0] >> 1) & 0x03;

  let multiplier = 1;
  let remainingLength = 0;
  let idx = 1;
  let encodedByte = 0;
  do {
    if (idx >= buf.length) return null;
    encodedByte = buf[idx++];
    remainingLength += (encodedByte & 0x7f) * multiplier;
    multiplier *= 128;
    if (multiplier > 128 * 128 * 128 * 128) return null;
  } while ((encodedByte & 0x80) !== 0);

  const totalLength = idx + remainingLength;
  if (buf.length < totalLength) return null;

  if (packetType === 2 && remainingLength >= 2) {
    return { type: 2, bytesConsumed: totalLength, connackCode: buf[idx + 1] };
  }

  if (packetType === 3) {
    if (remainingLength < 2) return { type: 3, bytesConsumed: totalLength };
    const topicLen = (buf[idx] << 8) | buf[idx + 1];
    const topicStart = idx + 2;
    const topicEnd = topicStart + topicLen;
    if (topicEnd > totalLength) return { type: 3, bytesConsumed: totalLength };
    const topic = textDecoder.decode(buf.subarray(topicStart, topicEnd));
    let payloadStart = topicEnd;
    if (qos > 0) payloadStart += 2;
    const payload =
      payloadStart <= totalLength ? textDecoder.decode(buf.subarray(payloadStart, totalLength)) : '';
    return { type: 3, bytesConsumed: totalLength, topic, payload };
  }

  return { type: packetType, bytesConsumed: totalLength };
}

type PresenceMsg =
  | { kind: 'hello'; role: ClientRole; id: string; ts: number; osBridge?: boolean }
  | { kind: 'bye'; role: ClientRole; id: string }
  | { kind: 'ping'; from: string; to?: string; ts: number }
  | { kind: 'pong'; from: string; to: string; ts: number };

type RtcSignalMsg =
  | { kind: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit };

export interface ServerlessRelayCallbacks {
  onStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
  onPeers: (counts: { mobile: number; desktop: number; osBridge: boolean }) => void;
  onLatency: (ms: number | null) => void;
  onCommand: (cmd: MouseCommand) => void;
  onP2PState?: (active: boolean) => void;
  onError?: (msg: string | null) => void;
}

export class ServerlessRelayClient {
  private readonly roomId: string;
  private readonly role: ClientRole;
  private readonly clientId: string;
  private readonly callbacks: ServerlessRelayCallbacks;

  private ws: WebSocket | null = null;
  private brokerIndex = 0;
  private closed = false;
  private rxBuffer: Uint8Array = new Uint8Array(0);
  private packetId = 1;
  private mqttReady = false;

  private pingTimer: number | null = null;
  private presenceTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private connectTimeoutTimer: number | null = null;

  // Track active peers by clientId -> { role, lastSeen, osBridge }
  private peers = new Map<string, { role: ClientRole; lastSeen: number; osBridge?: boolean }>();
  private activeMobileId: string | null = null;

  // Direct WebRTC P2P DataChannel for ultra-low-latency local Wi-Fi / Mobile Hotspot control
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private rtcPeerId: string | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];

  // Pace MQTT-WSS fallback publishes (~16/s max) with multi-command batching so public brokers never rate-limit
  private mqttOutQueue: MouseCommand[] = [];
  private mqttFlushTimer: number | null = null;
  private lastMqttPublishAt = 0;

  constructor(roomId: string, role: ClientRole, callbacks: ServerlessRelayCallbacks) {
    this.roomId = roomId;
    this.role = role;
    this.callbacks = callbacks;
    this.clientId = `ek_${role[0]}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private get presenceTopic(): string {
    return `elikunju/v2/${this.roomId}/presence`;
  }

  private get cmdTopic(): string {
    return `elikunju/v2/${this.roomId}/cmd`;
  }

  private get rtcTopic(): string {
    return `elikunju/v2/${this.roomId}/rtc`;
  }

  public start(): void {
    this.closed = false;
    this.connectNextBroker();
  }

  public stop(): void {
    this.closed = true;
    this.clearTimers();
    if (this.mqttReady) {
      this.publishJson(this.presenceTopic, {
        kind: 'bye',
        role: this.role,
        id: this.clientId,
      } satisfies PresenceMsg);
    }
    this.teardownRtc();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.mqttReady = false;
    this.peers.clear();
  }

  public sendCommand(cmd: MouseCommand): void {
    // When an OS bridge is running in the same room, ALWAYS send over MQTT so the OS bridge receives it too!
    // When only browser-to-browser is active and WebRTC DataChannel is open, use direct P2P for 1-3ms latency.
    const hasOsBridge = this.hasActiveOsBridge();
    if (!hasOsBridge && this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify(cmd));
        return;
      } catch {
        // Fall through to MQTT-WSS if DataChannel send fails
      }
    }
    if (!this.mqttReady) return;

    // Coalesce adjacent move or scroll deltas inside the pending MQTT batch to keep payloads tiny & lossless
    const last = this.mqttOutQueue[this.mqttOutQueue.length - 1];
    if (cmd.type === 'move' && last && last.type === 'move' && last.source === cmd.source) {
      last.dx = Number((last.dx + cmd.dx).toFixed(2));
      last.dy = Number((last.dy + cmd.dy).toFixed(2));
    } else if (cmd.type === 'scroll' && last && last.type === 'scroll') {
      last.dx = Number((last.dx + cmd.dx).toFixed(2));
      last.dy = Number((last.dy + cmd.dy).toFixed(2));
    } else {
      this.mqttOutQueue.push(cmd);
    }

    const now = performance.now();
    const minIntervalMs = 85;
    const elapsed = now - this.lastMqttPublishAt;

    if (elapsed >= minIntervalMs && this.mqttFlushTimer === null) {
      this.flushMqttQueue();
    } else if (this.mqttFlushTimer === null) {
      this.mqttFlushTimer = window.setTimeout(() => {
        this.mqttFlushTimer = null;
        this.flushMqttQueue();
      }, Math.max(12, minIntervalMs - elapsed));
    }
  }

  private hasActiveOsBridge(): boolean {
    const now = Date.now();
    for (const info of this.peers.values()) {
      if (info.osBridge && now - info.lastSeen <= 12000) return true;
    }
    return false;
  }

  private flushMqttQueue(): void {
    if (!this.mqttReady || this.mqttOutQueue.length === 0) return;
    const batch = this.mqttOutQueue.splice(0, 32);
    this.lastMqttPublishAt = performance.now();
    this.publishJson(this.cmdTopic, { from: this.clientId, cmds: batch });

    if (this.mqttOutQueue.length > 0 && this.mqttFlushTimer === null) {
      this.mqttFlushTimer = window.setTimeout(() => {
        this.mqttFlushTimer = null;
        this.flushMqttQueue();
      }, 85);
    }
  }

  private clearTimers(): void {
    if (this.mqttFlushTimer !== null) {
      window.clearTimeout(this.mqttFlushTimer);
      this.mqttFlushTimer = null;
    }
    this.mqttOutQueue = [];
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.presenceTimer !== null) {
      window.clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimeoutTimer !== null) {
      window.clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
  }

  private publishJson(topic: string, data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(buildMqttPublish(topic, JSON.stringify(data)));
    } catch {
      // Ignore send failure during disconnect
    }
  }

  private updatePeerCounts(): void {
    const now = Date.now();
    for (const [id, info] of this.peers.entries()) {
      if (now - info.lastSeen > 12000) {
        this.peers.delete(id);
      }
    }

    let mobile = this.role === 'mobile' ? 1 : 0;
    let desktop = this.role === 'desktop' ? 1 : 0;
    let osBridge = false;
    for (const info of this.peers.values()) {
      if (info.role === 'mobile') mobile += 1;
      if (info.role === 'desktop') desktop += 1;
      if (info.osBridge) osBridge = true;
    }
    this.callbacks.onPeers({ mobile, desktop, osBridge });
  }

  private connectNextBroker(): void {
    if (this.closed) return;
    this.clearTimers();
    this.mqttReady = false;
    this.rxBuffer = new Uint8Array(0);
    this.callbacks.onStatus('connecting');

    const brokerUrl = MQTT_BROKERS[this.brokerIndex % MQTT_BROKERS.length];
    let ws: WebSocket;
    try {
      ws = new WebSocket(brokerUrl, ['mqtt']);
      ws.binaryType = 'arraybuffer';
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    this.connectTimeoutTimer = window.setTimeout(() => {
      if (!this.mqttReady && !this.closed) {
        try {
          ws.close();
        } catch {
          // Ignore
        }
      }
    }, 5500);

    ws.onopen = () => {
      if (this.closed) {
        ws.close();
        return;
      }
      ws.send(buildMqttConnect(this.clientId));
    };

    ws.onmessage = (event) => {
      if (this.closed) return;
      if (!(event.data instanceof ArrayBuffer)) return;
      const chunk = new Uint8Array(event.data);
      this.rxBuffer = concatBytes(this.rxBuffer, chunk);

      while (this.rxBuffer.length > 0) {
        const pkt = tryParseMqttPacket(this.rxBuffer);
        if (!pkt) break;
        this.rxBuffer = this.rxBuffer.subarray(pkt.bytesConsumed);
        this.handlePacket(pkt);
      }
    };

    ws.onerror = () => {
      if (!this.closed && !this.mqttReady) {
        this.callbacks.onError?.('Switching to backup relay…');
      }
    };

    ws.onclose = () => {
      this.clearTimers();
      this.mqttReady = false;
      if (this.closed) return;
      this.callbacks.onStatus('disconnected');
      this.callbacks.onLatency(null);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.brokerIndex = (this.brokerIndex + 1) % MQTT_BROKERS.length;
    this.reconnectTimer = window.setTimeout(() => {
      this.connectNextBroker();
    }, 1200);
  }

  private handlePacket(pkt: ParsedMqttPacket): void {
    // CONNACK
    if (pkt.type === 2) {
      if (pkt.connackCode !== 0) {
        this.ws?.close();
        return;
      }
      if (this.connectTimeoutTimer !== null) {
        window.clearTimeout(this.connectTimeoutTimer);
        this.connectTimeoutTimer = null;
      }
      this.mqttReady = true;
      this.callbacks.onStatus('connected');
      this.callbacks.onError?.(null);

      const topics =
        this.role === 'desktop'
          ? [this.presenceTopic, this.cmdTopic, this.rtcTopic]
          : [this.presenceTopic, this.rtcTopic];

      this.ws?.send(buildMqttSubscribe(this.packetId++, topics));

      const announce = () => {
        if (!this.mqttReady) return;
        this.publishJson(this.presenceTopic, {
          kind: 'hello',
          role: this.role,
          id: this.clientId,
          ts: Date.now(),
        } satisfies PresenceMsg);
        this.updatePeerCounts();
      };

      announce();
      window.setTimeout(announce, 450);

      this.presenceTimer = window.setInterval(() => {
        announce();
        if (this.peers.size > 0) {
          this.publishJson(this.presenceTopic, {
            kind: 'ping',
            from: this.clientId,
            ts: performance.now(),
          } satisfies PresenceMsg);
        }
      }, 4000);

      this.pingTimer = window.setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(buildMqttPingReq());
        }
      }, 20000);

      return;
    }

    // PUBLISH
    if (pkt.type === 3 && pkt.topic && pkt.payload) {
      let msg: unknown;
      try {
        msg = JSON.parse(pkt.payload);
      } catch {
        return;
      }

      if (pkt.topic === this.presenceTopic) {
        this.handlePresence(msg as PresenceMsg);
      } else if (pkt.topic === this.cmdTopic && this.role === 'desktop') {
        const envelope = msg as { from?: string; cmd?: MouseCommand; cmds?: MouseCommand[] };
        const batch: MouseCommand[] = Array.isArray(envelope?.cmds)
          ? envelope.cmds
          : envelope?.cmd
          ? [envelope.cmd]
          : [];
        if (batch.length > 0) {
          if (envelope.from) {
            if (!this.activeMobileId) {
              this.activeMobileId = envelope.from;
            }
            if (envelope.from !== this.activeMobileId) {
              return;
            }
            this.peers.set(envelope.from, { role: 'mobile', lastSeen: Date.now() });
            this.updatePeerCounts();
          }
          for (const cmd of batch) {
            if (cmd && typeof cmd.type === 'string') {
              this.callbacks.onCommand(cmd);
            }
          }
        }
      } else if (pkt.topic === this.rtcTopic) {
        void this.handleRtcSignal(msg as RtcSignalMsg);
      }
    }
  }

  private handlePresence(msg: PresenceMsg): void {
    if (!msg || typeof msg !== 'object') return;

    if (msg.kind === 'hello') {
      if (msg.id === this.clientId) return;
      const isNewPeer = !this.peers.has(msg.id);
      this.peers.set(msg.id, {
        role: msg.role,
        lastSeen: Date.now(),
        osBridge: Boolean(msg.osBridge),
      });

      if (this.role === 'desktop' && msg.role === 'mobile') {
        this.activeMobileId = msg.id;
      }

      this.updatePeerCounts();

      if (isNewPeer) {
        this.publishJson(this.presenceTopic, {
          kind: 'hello',
          role: this.role,
          id: this.clientId,
          ts: Date.now(),
        } satisfies PresenceMsg);
      }

      // Only initiate WebRTC to browser desktops (OS bridges receive directly via MQTT)
      if (
        this.role === 'mobile' &&
        msg.role === 'desktop' &&
        !msg.osBridge &&
        this.rtcPeerId !== msg.id
      ) {
        void this.startRtcOffer(msg.id);
      }
      return;
    }

    if (msg.kind === 'bye') {
      if (msg.id === this.clientId) return;
      this.peers.delete(msg.id);
      if (this.rtcPeerId === msg.id) {
        this.teardownRtc();
      }
      this.updatePeerCounts();
      return;
    }

    if (msg.kind === 'ping') {
      if (msg.from === this.clientId) return;
      if (msg.to && msg.to !== this.clientId) return;
      this.publishJson(this.presenceTopic, {
        kind: 'pong',
        from: this.clientId,
        to: msg.from,
        ts: msg.ts,
      } satisfies PresenceMsg);
      return;
    }

    if (msg.kind === 'pong' && msg.to === this.clientId) {
      const rtt = Math.max(1, Math.round(performance.now() - msg.ts));
      this.callbacks.onLatency(rtt);
    }
  }

  private teardownRtc(): void {
    this.rtcPeerId = null;
    this.pendingIce = [];
    if (this.dc) {
      try {
        this.dc.close();
      } catch {
        // Ignore
      }
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // Ignore
      }
      this.pc = null;
    }
    this.callbacks.onP2PState?.(false);
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dc = channel;
    channel.onopen = () => {
      if (this.closed) return;
      this.callbacks.onP2PState?.(true);
    };
    channel.onclose = () => {
      this.callbacks.onP2PState?.(false);
    };
    channel.onerror = () => {
      this.callbacks.onP2PState?.(false);
    };
    channel.onmessage = (ev) => {
      if (this.closed || this.role !== 'desktop') return;
      try {
        const cmd = JSON.parse(String(ev.data)) as MouseCommand;
        if (cmd && typeof cmd.type === 'string') {
          this.callbacks.onCommand(cmd);
        }
      } catch {
        // Ignore malformed frame
      }
    };
  }

  private async flushPendingIce(): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription || this.pendingIce.length === 0) return;
    const queued = this.pendingIce.splice(0, this.pendingIce.length);
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale ICE candidate
      }
    }
  }

  private async startRtcOffer(targetDesktopId: string): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') return;
    this.teardownRtc();
    this.rtcPeerId = targetDesktopId;

    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.pc = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate && this.mqttReady) {
          this.publishJson(this.rtcTopic, {
            kind: 'ice',
            from: this.clientId,
            to: targetDesktopId,
            candidate: e.candidate.toJSON(),
          } satisfies RtcSignalMsg);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          this.callbacks.onP2PState?.(false);
        }
      };

      const channel = pc.createDataChannel('elikunju-mouse', { ordered: true });
      this.attachDataChannel(channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.publishJson(this.rtcTopic, {
        kind: 'offer',
        from: this.clientId,
        to: targetDesktopId,
        sdp: offer,
      } satisfies RtcSignalMsg);
    } catch {
      this.teardownRtc();
    }
  }

  private async handleRtcSignal(msg: RtcSignalMsg): Promise<void> {
    if (!msg || msg.to !== this.clientId || typeof RTCPeerConnection === 'undefined') return;

    try {
      if (msg.kind === 'offer' && this.role === 'desktop') {
        this.teardownRtc();
        this.rtcPeerId = msg.from;
        this.activeMobileId = msg.from;

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        this.pc = pc;

        pc.onicecandidate = (e) => {
          if (e.candidate && this.mqttReady) {
            this.publishJson(this.rtcTopic, {
              kind: 'ice',
              from: this.clientId,
              to: msg.from,
              candidate: e.candidate.toJSON(),
            } satisfies RtcSignalMsg);
          }
        };

        pc.ondatachannel = (ev) => {
          this.attachDataChannel(ev.channel);
        };

        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        await this.flushPendingIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.publishJson(this.rtcTopic, {
          kind: 'answer',
          from: this.clientId,
          to: msg.from,
          sdp: answer,
        } satisfies RtcSignalMsg);
        return;
      }

      if (msg.kind === 'answer' && this.role === 'mobile' && this.pc && this.rtcPeerId === msg.from) {
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await this.flushPendingIce();
        }
        return;
      }

      if (msg.kind === 'ice' && this.pc && this.rtcPeerId === msg.from) {
        if (this.pc.remoteDescription) {
          await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } else {
          this.pendingIce.push(msg.candidate);
        }
      }
    } catch {
      // Ignore transient WebRTC negotiation error; MQTT-WSS continues uninterrupted
    }
  }
}
