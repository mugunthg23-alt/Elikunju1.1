import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientRole, ClientToServerMessage, ServerToClientMessage } from './src/types/mouse.ts';
import { buildHotspotPythonBridge } from './src/server/hotspotBridge.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PeerClient {
  id: string;
  transport: 'ws' | 'sse';
  ws?: WebSocket;
  sseRes?: express.Response;
  roomId: string | null;
  role: ClientRole | null;
}

const rooms = new Map<string, Set<PeerClient>>();
let peerSeq = 0;

function sanitizeRoomId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
}

function sendToPeer(peer: PeerClient, serializedJson: string): void {
  if (peer.transport === 'ws') {
    if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(serializedJson);
    }
    return;
  }
  if (peer.sseRes && !peer.sseRes.writableEnded) {
    try {
      peer.sseRes.write(`data: ${serializedJson}\n\n`);
    } catch {
      // Ignore closed stream writes
    }
  }
}

function getLocalLanAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const group of Object.values(interfaces)) {
    if (!group) continue;
    for (const iface of group) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function broadcastRoomStatus(roomId: string): void {
  const members = rooms.get(roomId);
  if (!members || members.size === 0) return;

  let mobileCount = 0;
  let desktopCount = 0;
  for (const peer of members) {
    if (peer.role === 'mobile') mobileCount += 1;
    if (peer.role === 'desktop') desktopCount += 1;
  }

  const payload = JSON.stringify({
    type: 'peer:status',
    roomId,
    mobileCount,
    desktopCount,
  } satisfies ServerToClientMessage);

  for (const peer of members) {
    sendToPeer(peer, payload);
  }
}

function removeFromRoom(peer: PeerClient): void {
  if (!peer.roomId) return;
  const previousRoom = peer.roomId;
  const members = rooms.get(previousRoom);
  if (members) {
    members.delete(peer);
    if (members.size === 0) {
      rooms.delete(previousRoom);
    } else {
      broadcastRoomStatus(previousRoom);
    }
  }
  peer.roomId = null;
}

function joinPeerToRoom(peer: PeerClient, rawRoomId: string, role: ClientRole): string | null {
  const cleanRoom = sanitizeRoomId(rawRoomId || '');
  if (!cleanRoom) return null;

  removeFromRoom(peer);
  peer.roomId = cleanRoom;
  peer.role = role === 'desktop' ? 'desktop' : 'mobile';

  let members = rooms.get(cleanRoom);
  if (!members) {
    members = new Set();
    rooms.set(cleanRoom, members);
  }

  // Hand active mouse control to the most recently joined mobile peer in this room
  if (peer.role === 'mobile') {
    for (const existing of Array.from(members)) {
      if (existing !== peer && existing.role === 'mobile') {
        members.delete(existing);
        existing.roomId = null;
      }
    }
  }

  members.add(peer);
  broadcastRoomStatus(cleanRoom);
  return cleanRoom;
}

function relayCommandToDesktops(roomId: string, serializedJson: string, sender?: PeerClient): number {
  const members = rooms.get(roomId);
  if (!members) return 0;
  let delivered = 0;
  for (const target of members) {
    if (target !== sender && target.role === 'desktop') {
      sendToPeer(target, serializedJson);
      delivered += 1;
    }
  }
  return delivered;
}

function buildPythonBridgeScript(defaultRelayUrl: string, defaultRoomId: string): string {
  return `#!/usr/bin/env python3
"""
eli kunju Desktop OS Cursor Bridge
Moves your real Windows, macOS, or Linux cursor from your phone.

Setup (run once):
  pip install websockets pyautogui

Run (Room Pairing — works immediately with your published eli kunju app):
  python eli-kunju-bridge.py

Optional flags:
  python eli-kunju-bridge.py --room 4821
  python eli-kunju-bridge.py --lan        (direct local Wi-Fi server on port 8765)
"""

import argparse
import asyncio
import json
import socket
import sys

try:
    import websockets
    import pyautogui
except ImportError:
    print("Missing dependencies. Run: pip install websockets pyautogui")
    sys.exit(1)

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

DEFAULT_RELAY_URL = ${JSON.stringify(defaultRelayUrl)}
DEFAULT_ROOM = ${JSON.stringify(defaultRoomId)}
LAN_PORT = 8765


def get_lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def apply_command(msg: dict) -> None:
    kind = msg.get("type")
    if kind == "move":
        dx = float(msg.get("dx", 0))
        dy = float(msg.get("dy", 0))
        if dx != 0 or dy != 0:
            pyautogui.moveRel(dx, dy, _pause=False)
    elif kind == "click":
        btn = "right" if msg.get("button") == "right" else "left"
        pyautogui.click(button=btn, _pause=False)
    elif kind == "dblclick":
        # Tap 1 already fired click #1; fire click #2 to complete native OS double-click
        btn = "right" if msg.get("button") == "right" else "left"
        pyautogui.click(button=btn, _pause=False)
    elif kind == "down":
        btn = "right" if msg.get("button") == "right" else "left"
        pyautogui.mouseDown(button=btn, _pause=False)
    elif kind == "up":
        btn = "right" if msg.get("button") == "right" else "left"
        pyautogui.mouseUp(button=btn, _pause=False)
    elif kind == "scroll":
        dy = float(msg.get("dy", 0))
        if dy != 0:
            pyautogui.scroll(int(round(-dy * 4)), _pause=False)


async def run_relay_client(relay_url: str, room_id: str):
    print("=" * 58)
    print(" eli kunju Desktop OS Bridge (Room Pairing Mode)")
    print(f" Server : {relay_url}")
    print(f" Room   : {room_id}")
    print(" Open eli kunju on your phone -> top-right Wi-Fi icon")
    print(f" -> Room Pairing -> enter {room_id} -> Join")
    print("=" * 58)

    while True:
        try:
            async with websockets.connect(relay_url, ping_interval=15, ping_timeout=10, compression=None) as ws:
                await ws.send(json.dumps({"type": "join", "roomId": room_id, "role": "desktop"}))
                print(f"[eli kunju] Connected to room {room_id}. Ready for phone control.")
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if msg.get("type") == "peer:status":
                        mobiles = msg.get("mobileCount", 0)
                        print(f"[eli kunju] Room {room_id} status: {mobiles} phone(s) connected")
                    else:
                        apply_command(msg)
        except KeyboardInterrupt:
            return
        except Exception as err:
            print(f"[eli kunju] Connection dropped ({err}). Reconnecting in 2s...")
            await asyncio.sleep(2)


async def handle_lan_client(websocket):
    peer = websocket.remote_address
    print(f"[eli kunju] Phone connected over local Wi-Fi: {peer}")
    try:
        await websocket.send(json.dumps({
            "type": "peer:status",
            "roomId": "LAN",
            "mobileCount": 1,
            "desktopCount": 1,
        }))
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ping":
                await websocket.send(json.dumps({"type": "pong", "ts": msg.get("ts", 0)}))
            else:
                apply_command(msg)
    except Exception:
        pass
    finally:
        print(f"[eli kunju] Phone disconnected: {peer}")


async def run_lan_server():
    ip = get_lan_ip()
    print("=" * 58)
    print(" eli kunju Local Wi-Fi Direct LAN Bridge")
    print(f" Connect from local app to: ws://{ip}:{LAN_PORT}")
    print("=" * 58)
    async with websockets.serve(handle_lan_client, "0.0.0.0", LAN_PORT, compression=None):
        await asyncio.Future()


def main():
    parser = argparse.ArgumentParser(description="eli kunju Desktop OS Cursor Bridge")
    parser.add_argument("--room", default=DEFAULT_ROOM, help="4-digit pairing room code")
    parser.add_argument("--url", default=DEFAULT_RELAY_URL, help="eli kunju WebSocket URL")
    parser.add_argument("--lan", action="store_true", help="Run direct local Wi-Fi WebSocket server")
    args = parser.parse_args()

    try:
        if args.lan:
            asyncio.run(run_lan_server())
        else:
            asyncio.run(run_relay_client(args.url, args.room.upper()))
    except KeyboardInterrupt:
        print("\\n[eli kunju] Stopped.")


if __name__ == "__main__":
    main()
`;
}

function buildNodeRelayBridgeScript(defaultRelayUrl: string, defaultRoomId: string): string {
  return `#!/usr/bin/env node
/**
 * eli kunju Desktop OS Cursor Bridge (Node.js)
 * Moves your real Windows, macOS, or Linux cursor from your phone.
 *
 * Setup (run once):
 *   npm install ws @nut-tree-fork/nut-js
 *
 * Run (Room Pairing — works immediately with your published eli kunju app):
 *   node eli-kunju-bridge.mjs
 *
 * Optional flags:
 *   node eli-kunju-bridge.mjs --room 4821
 *   node eli-kunju-bridge.mjs --lan
 */
import os from 'os';
import { WebSocket, WebSocketServer } from 'ws';
import { mouse, Button, Point } from '@nut-tree-fork/nut-js';

mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 3000;

const DEFAULT_RELAY_URL = ${JSON.stringify(defaultRelayUrl)};
const DEFAULT_ROOM = ${JSON.stringify(defaultRoomId)};
const LAN_PORT = 8765;

const args = process.argv.slice(2);
const isLan = args.includes('--lan');
const roomIdx = args.indexOf('--room');
const roomId = (roomIdx >= 0 && args[roomIdx + 1] ? args[roomIdx + 1] : DEFAULT_ROOM).toUpperCase();

function getLanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

async function applyCommand(msg) {
  if (msg.type === 'move') {
    const pos = await mouse.getPosition();
    await mouse.setPosition(new Point(Math.round(pos.x + msg.dx), Math.round(pos.y + msg.dy)));
  } else if (msg.type === 'click' || msg.type === 'dblclick') {
    await mouse.click(msg.button === 'right' ? Button.RIGHT : Button.LEFT);
  } else if (msg.type === 'down') {
    await mouse.pressButton(msg.button === 'right' ? Button.RIGHT : Button.LEFT);
  } else if (msg.type === 'up') {
    await mouse.releaseButton(msg.button === 'right' ? Button.RIGHT : Button.LEFT);
  } else if (msg.type === 'scroll') {
    const amount = Math.round(Math.abs(msg.dy) * 3);
    if (amount > 0) {
      if (msg.dy > 0) await mouse.scrollDown(amount);
      else await mouse.scrollUp(amount);
    }
  }
}

if (isLan) {
  const wss = new WebSocketServer({ host: '0.0.0.0', port: LAN_PORT, perMessageDeflate: false });
  console.log('======================================================');
  console.log(' eli kunju Local Wi-Fi Direct LAN Bridge (Node.js)');
  console.log(\` Connect from local app to: ws://\${getLanIp()}:\${LAN_PORT}\`);
  console.log('======================================================');

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'peer:status', roomId: 'LAN', mobileCount: 1, desktopCount: 1 }));
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
        else await applyCommand(msg);
      } catch {}
    });
  });
} else {
  console.log('======================================================');
  console.log(' eli kunju Desktop OS Bridge (Room Pairing Mode)');
  console.log(\` Server : \${DEFAULT_RELAY_URL}\`);
  console.log(\` Room   : \${roomId}\`);
  console.log('======================================================');

  const connect = () => {
    const ws = new WebSocket(DEFAULT_RELAY_URL, { perMessageDeflate: false });
    let pingTimer = null;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', roomId, role: 'desktop' }));
      console.log(\`[eli kunju] Connected to room \${roomId}. Ready for phone control.\`);
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }
      }, 15000);
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'peer:status') {
          console.log(\`[eli kunju] Room \${roomId}: \${msg.mobileCount} phone(s) connected\`);
        } else if (msg.type !== 'pong') {
          await applyCommand(msg);
        }
      } catch {}
    });

    ws.on('close', () => {
      if (pingTimer) clearInterval(pingTimer);
      console.log('[eli kunju] Disconnected. Reconnecting in 2s...');
      setTimeout(connect, 2000);
    });

    ws.on('error', () => {
      ws.close();
    });
  };

  connect();
}
`;
}

function resolveRelayWsUrl(req: express.Request): string {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto === 'https' || req.secure ? 'wss' : 'ws';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}/ws`;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '64kb' }));

  // Allow cross-origin API relay when a mobile scans a QR code from a different origin
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/network-info', (_req, res) => {
    res.json({
      lanAddresses: getLocalLanAddresses(),
      port: PORT,
    });
  });

  // HTTP Server-Sent Events fallback stream for networks where WebSockets are blocked
  app.get('/api/room/:roomId/stream', (req, res) => {
    const cleanRoom = sanitizeRoomId(String(req.params.roomId || ''));
    const role: ClientRole = req.query.role === 'desktop' ? 'desktop' : 'mobile';
    if (!cleanRoom) {
      res.status(400).json({ error: 'Invalid room code' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const peer: PeerClient = {
      id: `sse-${++peerSeq}`,
      transport: 'sse',
      sseRes: res,
      roomId: null,
      role: null,
    };

    joinPeerToRoom(peer, cleanRoom, role);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      removeFromRoom(peer);
    });
  });

  // HTTP POST fallback endpoint to relay mouse commands (works even when WS is unavailable)
  app.post('/api/room/:roomId/cmd', (req, res) => {
    const cleanRoom = sanitizeRoomId(String(req.params.roomId || ''));
    if (!cleanRoom) {
      res.status(400).json({ error: 'Invalid room code' });
      return;
    }
    const body = req.body as { commands?: unknown[]; command?: unknown };
    const list = Array.isArray(body?.commands)
      ? body.commands
      : body?.command
      ? [body.command]
      : body && typeof body === 'object' && 'type' in body
      ? [body]
      : [];

    let delivered = 0;
    for (const cmd of list) {
      if (!cmd || typeof cmd !== 'object') continue;
      delivered += relayCommandToDesktops(cleanRoom, JSON.stringify(cmd));
    }

    const members = rooms.get(cleanRoom);
    let desktopCount = 0;
    let mobileCount = 0;
    if (members) {
      for (const m of members) {
        if (m.role === 'desktop') desktopCount += 1;
        if (m.role === 'mobile') mobileCount += 1;
      }
    }

    res.json({ ok: true, delivered, desktopCount, mobileCount });
  });

  app.get('/api/desktop-bridge/hotspot', (req, res) => {
    const room = sanitizeRoomId(String(req.query.room || '4821')) || '4821';
    const relayUrl = resolveRelayWsUrl(req);
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eli-kunju-hotspot.py"');
    res.send(buildHotspotPythonBridge(relayUrl, room));
  });

  app.get('/api/desktop-bridge/python', (req, res) => {
    const room = sanitizeRoomId(String(req.query.room || '4821')) || '4821';
    const relayUrl = resolveRelayWsUrl(req);
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eli-kunju-bridge.py"');
    res.send(buildPythonBridgeScript(relayUrl, room));
  });

  app.get('/api/desktop-bridge/node', (req, res) => {
    const room = sanitizeRoomId(String(req.query.room || '4821')) || '4821';
    const relayUrl = resolveRelayWsUrl(req);
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eli-kunju-bridge.mjs"');
    res.send(buildNodeRelayBridgeScript(relayUrl, room));
  });

  // Low-latency WebSocket server routed exclusively on /ws (does not interfere with Vite HMR upgrades)
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    const peer: PeerClient = {
      id: `ws-${++peerSeq}`,
      transport: 'ws',
      ws,
      roomId: null,
      role: null,
    };

    ws.on('message', (data) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientToServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        sendToPeer(peer, JSON.stringify({ type: 'pong', ts: msg.ts } satisfies ServerToClientMessage));
        return;
      }

      if (msg.type === 'join') {
        joinPeerToRoom(peer, msg.roomId || '', msg.role === 'desktop' ? 'desktop' : 'mobile');
        return;
      }

      // Route mouse commands immediately to desktop peers in the same room (both WS and SSE peers)
      if (!peer.roomId) return;
      relayCommandToDesktops(peer.roomId, JSON.stringify(msg), peer);
    });

    ws.on('close', () => {
      removeFromRoom(peer);
    });

    ws.on('error', () => {
      removeFromRoom(peer);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    app.get('/manifest.webmanifest', (_req, res) => {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.json({
        id: '/',
        name: 'eli kunju',
        short_name: 'eli kunju',
        description:
          'Low-latency Wi-Fi mobile mouse controller with touch gestures, motion tracking, left/right click zones, and head scroll bar.',
        theme_color: '#101827',
        background_color: '#101827',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      });
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: { server },
        ws: { server, path: '/__vite_hmr' },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`eli kunju server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
