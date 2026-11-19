import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientRole,
  ClientToServerMessage,
  ConnectionMode,
  MouseCommand,
  ServerToClientMessage,
} from '../types/mouse';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseMouseSocketOptions {
  role: ClientRole;
  roomId: string;
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
  const [peerCounts, setPeerCounts] = useState({ mobile: 0, desktop: 0 });
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  // Coalesce rapid pointer/motion moves within a single animation frame for ultra-low latency without flooding
  const pendingMoveRef = useRef<{ dx: number; dy: number; source: 'touch' | 'motion' } | null>(null);
  const rafRef = useRef<number | null>(null);

  const sendRaw = useCallback((payload: ClientToServerMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const flushMove = useCallback(() => {
    rafRef.current = null;
    const pending = pendingMoveRef.current;
    if (!pending) return;
    pendingMoveRef.current = null;
    if (Math.abs(pending.dx) < 0.05 && Math.abs(pending.dy) < 0.05) return;
    sendRaw({
      type: 'move',
      dx: Number(pending.dx.toFixed(2)),
      dy: Number(pending.dy.toFixed(2)),
      source: pending.source,
    });
  }, [sendRaw]);

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
      sendRaw(cmd);
    },
    [flushMove, sendRaw]
  );

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let retryAttempt = 0;

    const resolveTargetUrl = (): string | null => {
      if (connectionMode === 'lan') {
        const trimmed = lanUrl.trim();
        if (!trimmed) return null;
        if (/^wss?:\/\//i.test(trimmed)) return trimmed;
        return `ws://${trimmed}`;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}/ws`;
    };

    const connect = () => {
      if (cancelled) return;
      const url = resolveTargetUrl();
      if (!url) {
        setStatus('disconnected');
        setErrorDetail('Enter your laptop local Wi-Fi address (e.g. ws://192.168.1.24:8765).');
        return;
      }

      setStatus('connecting');
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

        if (connectionMode === 'relay' && roomId) {
          ws.send(JSON.stringify({ type: 'join', roomId, role } satisfies ClientToServerMessage));
        }

        // Measure genuine round-trip latency every 4 seconds
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
          const rtt = Math.max(1, Math.round(performance.now() - msg.ts));
          setLatencyMs(rtt);
        } else if (msg.type === 'peer:status') {
          setPeerCounts({ mobile: msg.mobileCount, desktop: msg.desktopCount });
        } else {
          onCommandRef.current?.(msg);
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        if (connectionMode === 'lan' && window.location.protocol === 'https:' && url.startsWith('ws://')) {
          setErrorDetail(
            'HTTPS pages block insecure ws:// LAN sockets in some browsers. Use Room Pairing or run eli kunju directly on your local Wi-Fi laptop.'
          );
        } else {
          setErrorDetail('Unable to reach server. Retrying…');
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
        setPeerCounts({ mobile: 0, desktop: 0 });
        retryAttempt = Math.min(retryAttempt + 1, 5);
        const delay = Math.min(800 * Math.pow(1.6, retryAttempt - 1), 6000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

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
    peerCounts,
    isPeerReady,
    latencyMs,
    errorDetail,
    sendCommand,
  };
}
