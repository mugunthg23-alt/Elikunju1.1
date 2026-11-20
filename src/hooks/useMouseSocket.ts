import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientRole,
  ClientToServerMessage,
  ConnectionMode,
  MouseCommand,
  ServerToClientMessage,
} from '../types/mouse';
import { ServerlessRelayClient } from '../lib/serverlessRelay';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
export type TransportKind = 'p2p' | 'relay' | 'lan' | 'none';

interface UseMouseSocketOptions {
  role: ClientRole;
  roomId: string;
  relayOrigin?: string;
  connectionMode: ConnectionMode;
  lanUrl: string;
  onCommand?: (cmd: MouseCommand) => void;
}

export function useMouseSocket({
  role,
  roomId,
  connectionMode,
  lanUrl,
  onCommand,
}: UseMouseSocketOptions) {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [transport, setTransport] = useState<TransportKind>('none');
  const [peerCounts, setPeerCounts] = useState({ mobile: 0, desktop: 0 });
  const [osBridgeConnected, setOsBridgeConnected] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const relayRef = useRef<ServerlessRelayClient | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  // Coalesce rapid pointer/motion moves within a single animation frame for ultra-low latency without flooding
  const pendingMoveRef = useRef<{ dx: number; dy: number; source: 'touch' | 'motion' } | null>(null);
  const rafRef = useRef<number | null>(null);

  const sendRawCommand = useCallback((cmd: MouseCommand) => {
    if (relayRef.current) {
      relayRef.current.sendCommand(cmd);
      return;
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(cmd satisfies ClientToServerMessage));
    }
  }, []);

  const flushMove = useCallback(() => {
    rafRef.current = null;
    const pending = pendingMoveRef.current;
    if (!pending) return;
    pendingMoveRef.current = null;
    if (Math.abs(pending.dx) < 0.05 && Math.abs(pending.dy) < 0.05) return;
    sendRawCommand({
      type: 'move',
      dx: Number(pending.dx.toFixed(2)),
      dy: Number(pending.dy.toFixed(2)),
      source: pending.source,
    });
  }, [sendRawCommand]);

  const sendCommand = useCallback(
    (cmd: MouseCommand) => {
      if (cmd.type === 'move') {
        if (pendingMoveRef.current) {
          pendingMoveRef.current.dx += cmd.dx;
          pendingMoveRef.current.dy += cmd.dy;
          pendingMoveRef.current.source = cmd.source;
        } else {
          pendingMoveRef.current = { dx: cmd.dx, dy: cmd.dy, source: cmd.source };
        }
        if (rafRef.current === null) {
          rafRef.current = window.requestAnimationFrame(flushMove);
        }
        return;
      }

      // Flush any buffered move before click/down/up/scroll so ordering stays exact
      if (pendingMoveRef.current) {
        if (rafRef.current !== null) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        flushMove();
      }
      sendRawCommand(cmd);
    },
    [flushMove, sendRawCommand]
  );

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let retryAttempt = 0;

    setPeerCounts({ mobile: 0, desktop: 0 });
    setOsBridgeConnected(false);
    setLatencyMs(null);
    setErrorDetail(null);

    // Primary QR / Room Pairing mode: Serverless MQTT-WSS + Direct WebRTC P2P DataChannel
    // Works identically on static Netlify hosting, AI Studio Cloud Run, Wi-Fi, Mobile Hotspot, and 4G/5G!
    if (connectionMode === 'relay') {
      if (!roomId) {
        setStatus('disconnected');
        setTransport('none');
        return;
      }

      setStatus('connecting');
      setTransport('relay');

      const client = new ServerlessRelayClient(roomId, role, {
        onStatus: (nextStatus) => {
          if (cancelled) return;
          setStatus(nextStatus);
        },
        onPeers: (counts) => {
          if (cancelled) return;
          setPeerCounts({ mobile: counts.mobile, desktop: counts.desktop });
          setOsBridgeConnected(counts.osBridge);
        },
        onLatency: (ms) => {
          if (cancelled) return;
          setLatencyMs(ms);
        },
        onCommand: (cmd) => {
          if (cancelled) return;
          onCommandRef.current?.(cmd);
        },
        onP2PState: (active) => {
          if (cancelled) return;
          setTransport(active ? 'p2p' : 'relay');
        },
        onError: (msg) => {
          if (cancelled) return;
          setErrorDetail(msg);
        },
      });

      relayRef.current = client;
      client.start();

      return () => {
        cancelled = true;
        if (rafRef.current !== null) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        client.stop();
        if (relayRef.current === client) {
          relayRef.current = null;
        }
      };
    }

    // Optional Direct LAN WebSocket mode (for self-hosted local bridge ws://192.168.x.x:8765)
    const resolveLanUrl = (): string | null => {
      const trimmed = lanUrl.trim();
      if (!trimmed) return null;
      if (/^wss?:\/\//i.test(trimmed)) return trimmed;
      return `ws://${trimmed}`;
    };

    const connectLan = () => {
      if (cancelled) return;
      const url = resolveLanUrl();
      if (!url) {
        setStatus('disconnected');
        setTransport('none');
        setErrorDetail('Enter your laptop local Wi-Fi address (e.g. ws://192.168.1.24:8765).');
        return;
      }

      setStatus('connecting');
      setTransport('lan');
      setErrorDetail(null);

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        setStatus('error');
        setErrorDetail('Could not open WebSocket connection. Check the address format.');
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        retryAttempt = 0;
        setStatus('connected');
        setErrorDetail(null);

        const sendPing = () => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', ts: performance.now() }));
          }
        };
        sendPing();
        pingTimer = window.setInterval(sendPing, 4000);
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        let msg: ServerToClientMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerToClientMessage;
        } catch {
          return;
        }
        if (msg.type === 'pong') {
          setLatencyMs(Math.max(1, Math.round(performance.now() - msg.ts)));
        } else if (msg.type === 'peer:status') {
          setPeerCounts({ mobile: msg.mobileCount, desktop: msg.desktopCount });
        } else {
          onCommandRef.current?.(msg);
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        if (window.location.protocol === 'https:' && url.startsWith('ws://')) {
          setErrorDetail('HTTPS pages block insecure ws:// LAN sockets. Scan the laptop QR code instead.');
        } else {
          setErrorDetail('Unable to reach local Wi-Fi server. Retrying…');
        }
      };

      ws.onclose = () => {
        if (pingTimer !== null) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (cancelled) return;
        setStatus('disconnected');
        setLatencyMs(null);
        retryAttempt = Math.min(retryAttempt + 1, 5);
        const delay = Math.min(1000 * Math.pow(1.6, retryAttempt - 1), 6000);
        reconnectTimer = window.setTimeout(connectLan, delay);
      };
    };

    connectLan();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (pingTimer !== null) window.clearInterval(pingTimer);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [role, roomId, connectionMode, lanUrl]);

  const isPeerReady =
    status === 'connected' &&
    (connectionMode === 'lan' || (role === 'mobile' ? peerCounts.desktop > 0 : peerCounts.mobile > 0));

  return {
    status,
    transport,
    peerCounts,
    osBridgeConnected,
    isPeerReady,
    latencyMs,
    errorDetail,
    sendCommand,
  };
}
