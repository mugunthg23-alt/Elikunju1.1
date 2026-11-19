import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedMouseBase64: string | null = null;

function getMouseImageBase64(): string {
  if (cachedMouseBase64 !== null) return cachedMouseBase64;
  const candidates = [
    path.resolve(__dirname, '../../public/assets/aistudio/image_2d5faa2c.png'),
    path.resolve(__dirname, '../../dist/assets/aistudio/image_2d5faa2c.png'),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      cachedMouseBase64 = fs.readFileSync(filePath).toString('base64');
      return cachedMouseBase64;
    }
  }
  cachedMouseBase64 = '';
  return '';
}

function buildStandaloneHotspotHtml(): string {
  const b64 = getMouseImageBase64();
  const imgSrc = b64 ? `data:image/png;base64,${b64}` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <meta name="theme-color" content="#101827" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <title>eli kunju Hotspot</title>
  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100dvh; overflow: hidden;
      background: #101827; color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none;
    }
    #stage {
      position: relative; width: 100vw; height: 100dvh;
      display: flex; align-items: center; justify-content: center; overflow: hidden;
    }
    #mouse-box {
      position: relative; aspect-ratio: 395 / 547;
      height: min(86dvh, 640px); max-height: calc(100dvh - 32px); max-width: 92vw;
      transform: translateX(5.4%);
    }
    #mouse-box img {
      display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none;
    }
    #overlay {
      position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
    }
    .zone-glow { transition: opacity 140ms ease; opacity: 0; }
    .guide-layer { transition: opacity 450ms ease; opacity: 0; }
    #guide-caption {
      position: fixed; left: 16px; right: 16px; bottom: 24px;
      text-align: center; font-size: 12px; color: rgba(203, 213, 225, 0.85);
      pointer-events: none; transition: opacity 450ms ease; opacity: 0;
    }
    .ripple {
      position: absolute; width: 56px; height: 56px; border-radius: 999px;
      pointer-events: none; border: 2px solid rgba(247, 223, 201, 0.85);
      background: rgba(247, 223, 201, 0.16);
      transform: translate(-50%, -50%) scale(0.45);
      animation: rippleOut 260ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .ripple.right {
      border-color: rgba(244, 166, 184, 0.85);
      background: rgba(244, 166, 184, 0.16);
    }
    @keyframes rippleOut {
      to { transform: translate(-50%, -50%) scale(1.85); opacity: 0; }
    }
    @keyframes guideScroll {
      0%, 100% { transform: translateY(-14px); opacity: 0.75; }
      50% { transform: translateY(14px); opacity: 1; }
    }
    .guide-thumb { animation: guideScroll 1.6s ease-in-out infinite; }
  </style>
</head>
<body>
  <div id="stage" aria-label="eli kunju Hotspot Controller">
    <div id="mouse-box">
      <img src="${imgSrc}" alt="Interactive Mouse" draggable="false" />
      <svg id="overlay" viewBox="0 0 395 547" aria-hidden="true">
        <defs>
          <clipPath id="left-clip"><rect x="0" y="286" width="176" height="261" /></clipPath>
          <clipPath id="right-clip"><rect x="176" y="286" width="219" height="261" /></clipPath>
        </defs>
        <ellipse id="glow-left" class="zone-glow" cx="176" cy="384" rx="153" ry="100" clip-path="url(#left-clip)" fill="rgba(255,245,232,0.22)" stroke="rgba(255,237,213,0.68)" stroke-width="3" />
        <ellipse id="glow-right" class="zone-glow" cx="176" cy="384" rx="153" ry="100" clip-path="url(#right-clip)" fill="rgba(255,245,232,0.22)" stroke="rgba(255,237,213,0.68)" stroke-width="3" />
        <g id="glow-scroll" class="zone-glow">
          <ellipse cx="176" cy="196" rx="116" ry="89" fill="rgba(255,248,240,0.10)" stroke="rgba(255,237,213,0.45)" stroke-width="2.5" />
          <rect x="171" y="148" width="10" height="96" rx="5" fill="rgba(16,24,39,0.45)" />
          <rect id="scroll-thumb" x="173" y="180" width="6" height="32" rx="3" fill="rgba(255,247,237,0.92)" />
        </g>
        <g id="guide-svg" class="guide-layer">
          <ellipse cx="176" cy="196" rx="116" ry="89" fill="rgba(247,223,201,0.08)" stroke="rgba(247,223,201,0.72)" stroke-width="2" stroke-dasharray="6 5" />
          <rect x="165" y="152" width="22" height="88" rx="11" fill="rgba(16,24,39,0.62)" stroke="rgba(247,223,201,0.65)" stroke-width="1.5" />
          <rect class="guide-thumb" x="172.5" y="186" width="7" height="20" rx="3.5" fill="#F7DFC9" />
          <text x="176" y="138" text-anchor="middle" fill="#F8FAFC" font-size="13" font-weight="600" style="paint-order:stroke;stroke:rgba(16,24,39,0.85);stroke-width:4px;">SCROLL</text>
          <ellipse cx="176" cy="384" rx="153" ry="100" clip-path="url(#left-clip)" fill="rgba(247,223,201,0.12)" stroke="rgba(247,223,201,0.72)" stroke-width="2" stroke-dasharray="6 5" />
          <ellipse cx="176" cy="384" rx="153" ry="100" clip-path="url(#right-clip)" fill="rgba(244,166,184,0.12)" stroke="rgba(244,166,184,0.75)" stroke-width="2" stroke-dasharray="6 5" />
        </g>
      </svg>
    </div>
    <div id="guide-caption">Drag head to scroll · Tap sides to click · Slide anywhere to move</div>
  </div>
  <script>
    const WS_PORT = __WS_PORT__;
    const stage = document.getElementById('stage');
    const box = document.getElementById('mouse-box');
    const glowLeft = document.getElementById('glow-left');
    const glowRight = document.getElementById('glow-right');
    const glowScroll = document.getElementById('glow-scroll');
    const scrollThumb = document.getElementById('scroll-thumb');
    const guideSvg = document.getElementById('guide-svg');
    const guideCaption = document.getElementById('guide-caption');

    // First-launch momentary guide
    let guideVisible = !localStorage.getItem('pm_hotspot_guide_seen');
    let guideTimer = null;
    function hideGuide() {
      if (!guideVisible) return;
      guideVisible = false;
      guideSvg.style.opacity = '0';
      guideCaption.style.opacity = '0';
      if (guideTimer) clearTimeout(guideTimer);
      try { localStorage.setItem('pm_hotspot_guide_seen', '1'); } catch {}
    }
    if (guideVisible) {
      guideSvg.style.opacity = '1';
      guideCaption.style.opacity = '1';
      guideTimer = setTimeout(hideGuide, 3800);
    }

    // Ultra-low-latency direct hotspot WebSocket
    let ws = null;
    let pendingMove = null;
    let rafId = null;
    function connectWs() {
      ws = new WebSocket('ws://' + location.hostname + ':' + WS_PORT);
      ws.onclose = () => setTimeout(connectWs, 1000);
      ws.onerror = () => { try { ws.close(); } catch {} };
    }
    connectWs();

    function sendRaw(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    }
    function flushMove() {
      rafId = null;
      if (!pendingMove) return;
      const m = pendingMove;
      pendingMove = null;
      if (Math.abs(m.dx) > 0.05 || Math.abs(m.dy) > 0.05) {
        sendRaw({ type: 'move', dx: Number(m.dx.toFixed(2)), dy: Number(m.dy.toFixed(2)), source: 'touch' });
      }
    }
    function sendCmd(cmd) {
      if (cmd.type === 'move') {
        if (pendingMove) { pendingMove.dx += cmd.dx; pendingMove.dy += cmd.dy; }
        else { pendingMove = { dx: cmd.dx, dy: cmd.dy }; }
        if (!rafId) rafId = requestAnimationFrame(flushMove);
        return;
      }
      if (pendingMove) { if (rafId) cancelAnimationFrame(rafId); flushMove(); }
      sendRaw(cmd);
    }

    function classify(cx, cy) {
      const r = box.getBoundingClientRect();
      const ix = ((cx - r.left) / r.width) * 395;
      const iy = ((cy - r.top) / r.height) * 547;
      const hdx = (ix - 176) / 122, hdy = (iy - 196) / 94;
      if (((hdx*hdx + hdy*hdy <= 1.06) || (iy >= 16 && iy <= 140 && ix >= 40 && ix <= 312)) && iy <= 292) return 'head';
      const bdx = (ix - 176) / 158, bdy = (iy - 384) / 104;
      if (bdx*bdx + bdy*bdy <= 1.08 && iy >= 282) return ix < 176 ? 'left' : 'right';
      return 'canvas';
    }

    function spawnRipple(cx, cy, btn) {
      const el = document.createElement('span');
      el.className = 'ripple' + (btn === 'right' ? ' right' : '');
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      stage.appendChild(el);
      setTimeout(() => el.remove(), 280);
    }

    let scrollOffset = 0, scrollHideTimer = null;
    function flashScroll(dy) {
      scrollOffset = Math.max(-34, Math.min(34, scrollOffset + dy * 0.45));
      scrollThumb.setAttribute('y', String(180 + scrollOffset));
      glowScroll.style.opacity = '1';
      if (scrollHideTimer) clearTimeout(scrollHideTimer);
      scrollHideTimer = setTimeout(() => { glowScroll.style.opacity = '0'; scrollOffset = 0; }, 240);
    }

    const pointers = new Map();
    let g = { id: null, zone: 'canvas', sx: 0, sy: 0, lx: 0, ly: 0, st: 0, moved: false, dragBtn: null, holdTimer: null, twoY: 0, twoMoved: false, twoStart: 0 };
    let lastTap = null;

    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('pointerdown', (e) => {
      hideGuide();
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        if (g.holdTimer) { clearTimeout(g.holdTimer); g.holdTimer = null; }
        if (g.dragBtn) { sendCmd({ type: 'up', button: g.dragBtn }); g.dragBtn = null; }
        const pts = Array.from(pointers.values());
        g.twoY = (pts[0].y + pts[1].y) / 2;
        g.twoMoved = false;
        g.twoStart = performance.now();
        return;
      }
      if (pointers.size > 2) return;

      const z = classify(e.clientX, e.clientY);
      g.id = e.pointerId; g.zone = z;
      g.sx = g.lx = e.clientX; g.sy = g.ly = e.clientY;
      g.st = performance.now(); g.moved = false; g.dragBtn = null;

      glowLeft.style.opacity = z === 'left' ? '1' : '0';
      glowRight.style.opacity = z === 'right' ? '1' : '0';
      if (z === 'head') glowScroll.style.opacity = '1';

      if (z === 'left' || z === 'right') {
        g.holdTimer = setTimeout(() => {
          if (g.id === e.pointerId && !g.moved) {
            g.dragBtn = z;
            sendCmd({ type: 'down', button: z });
            if (navigator.vibrate) try { navigator.vibrate(18); } catch {}
          }
        }, 340);
      }
    });

    stage.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const avgY = (pts[0].y + pts[1].y) / 2;
        const dy = avgY - g.twoY;
        g.twoY = avgY;
        if (Math.abs(dy) > 1.2) {
          g.twoMoved = true;
          sendCmd({ type: 'scroll', dx: 0, dy: dy * 0.65 });
          flashScroll(dy);
        }
        return;
      }
      if (g.id !== e.pointerId) return;

      const rawDx = e.clientX - g.lx, rawDy = e.clientY - g.ly;
      g.lx = e.clientX; g.ly = e.clientY;
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 10 && !g.moved) {
        g.moved = true;
        if (g.holdTimer) { clearTimeout(g.holdTimer); g.holdTimer = null; }
      }
      if (!g.moved && !g.dragBtn) return;

      if (g.zone === 'head') {
        sendCmd({ type: 'scroll', dx: rawDx * 0.45, dy: rawDy * 0.85 });
        flashScroll(rawDy);
        return;
      }

      const speed = Math.hypot(rawDx, rawDy);
      const accel = 1 + Math.min(speed / 22, 1.35);
      sendCmd({ type: 'move', dx: rawDx * 1.7 * accel, dy: rawDy * 1.7 * accel });
    });

    function endPointer(e, cancelled) {
      const wasTwo = pointers.size === 2;
      pointers.delete(e.pointerId);
      if (wasTwo && !cancelled && !g.twoMoved && performance.now() - g.twoStart < 260) {
        sendCmd({ type: 'click', button: 'right' });
        spawnRipple(e.clientX, e.clientY, 'right');
      }
      if (g.id !== e.pointerId) return;
      if (g.holdTimer) { clearTimeout(g.holdTimer); g.holdTimer = null; }
      glowLeft.style.opacity = '0';
      glowRight.style.opacity = '0';
      glowScroll.style.opacity = '0';

      if (g.dragBtn) {
        sendCmd({ type: 'up', button: g.dragBtn });
        g.dragBtn = null;
      } else if (!cancelled && !g.moved && performance.now() - g.st <= 320) {
        if (g.zone === 'left' || g.zone === 'right') {
          const btn = g.zone;
          const now = performance.now();
          if (btn === 'left' && lastTap && lastTap.btn === 'left' && now - lastTap.t < 300) {
            lastTap = null;
            sendCmd({ type: 'dblclick', button: 'left' });
          } else {
            lastTap = { btn, t: now };
            sendCmd({ type: 'click', button: btn });
          }
          spawnRipple(e.clientX, e.clientY, btn);
          if (navigator.vibrate) try { navigator.vibrate(btn === 'left' ? 12 : [10, 22, 10]); } catch {}
        }
      }
      g.id = null;
    }

    stage.addEventListener('pointerup', (e) => endPointer(e, false));
    stage.addEventListener('pointercancel', (e) => endPointer(e, true));
  </script>
</body>
</html>`;
}

export function buildHotspotPythonBridge(defaultRelayUrl: string, defaultRoomId: string): string {
  const htmlB64 = Buffer.from(buildStandaloneHotspotHtml(), 'utf-8').toString('base64');

  return `#!/usr/bin/env python3
"""
eli kunju Mobile Hotspot Bridge (Direct Offline + Room Pairing)
Control your laptop cursor directly over your phone's Mobile Hotspot with ~1-2ms latency —
even with mobile data / internet turned OFF.

Setup (run once on your laptop):
  pip install websockets pyautogui

Run (Mobile Hotspot Direct Mode — default):
  python eli-kunju-hotspot.py

Optional:
  python eli-kunju-hotspot.py --relay --room ${defaultRoomId}   (pair via installed HTTPS app)
"""

import argparse
import asyncio
import base64
import http.server
import json
import socket
import sys
import threading

try:
    import websockets
    import pyautogui
except ImportError:
    print("Missing dependencies. Run once:")
    print("  pip install websockets pyautogui")
    sys.exit(1)

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

HTTP_PORT = 8764
WS_PORT = 8765
DEFAULT_RELAY_URL = ${JSON.stringify(defaultRelayUrl)}
DEFAULT_ROOM = ${JSON.stringify(defaultRoomId)}

MOUSE_HTML_B64 = ${JSON.stringify(htmlB64)}
MOUSE_HTML_BYTES = base64.b64decode(MOUSE_HTML_B64).decode("utf-8").replace("__WS_PORT__", str(WS_PORT)).encode("utf-8")


def discover_hotspot_ips() -> list[str]:
    ips: list[str] = []

    # 1) Default route interface (usually the active Mobile Hotspot Wi-Fi adapter)
    for target in (("192.168.43.1", 80), ("172.20.10.1", 80), ("192.168.137.1", 80), ("8.8.8.8", 80)):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(target)
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
        except Exception:
            pass
        finally:
            s.close()

    # 2) All local hostname IPv4 addresses
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass

    # Prioritize common Android (192.168.43.x / 192.168.x.x) and iPhone (172.20.10.x) hotspot subnets
    def priority(ip: str) -> int:
        if ip.startswith("192.168.43.") or ip.startswith("172.20.10."):
            return 0
        if ip.startswith("192.168.137.") or ip.startswith("192.168."):
            return 1
        if ip.startswith("10.") or ip.startswith("172."):
            return 2
        return 3

    ips.sort(key=priority)
    return ips or ["127.0.0.1"]


def apply_command(msg: dict) -> None:
    kind = msg.get("type")
    if kind == "move":
        dx = float(msg.get("dx", 0))
        dy = float(msg.get("dy", 0))
        if dx != 0 or dy != 0:
            pyautogui.moveRel(dx, dy, _pause=False)
    elif kind == "click" or kind == "dblclick":
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


class HotspotMouseHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(MOUSE_HTML_BYTES)))
        self.end_headers()
        self.wfile.write(MOUSE_HTML_BYTES)

    def log_message(self, format, *args):
        return


def start_http_server():
    server = http.server.ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), HotspotMouseHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


async def handle_hotspot_ws(websocket):
    peer = websocket.remote_address
    print(f"[eli kunju] Phone connected over Mobile Hotspot: {peer}")
    try:
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


async def run_hotspot_mode():
    start_http_server()
    ips = discover_hotspot_ips()
    primary = ips[0]
    print("=" * 62)
    print(" eli kunju — Mobile Hotspot Direct Mode (Offline / <2ms)")
    print(" 1. Connect this laptop to your phone's Mobile Hotspot.")
    print(" 2. Open this address in your phone's browser:")
    print(f"    http://{primary}:{HTTP_PORT}")
    if len(ips) > 1:
        print("    Alternate IPs: " + ", ".join(f"http://{ip}:{HTTP_PORT}" for ip in ips[1:4]))
    print(" Tip: Allow Python through Windows Firewall if prompted.")
    print("=" * 62)
    async with websockets.serve(handle_hotspot_ws, "0.0.0.0", WS_PORT, compression=None):
        await asyncio.Future()


async def run_relay_mode(relay_url: str, room_id: str):
    print("=" * 62)
    print(" eli kunju — Room Pairing Mode (via Installed App)")
    print(f" Server : {relay_url}")
    print(f" Room   : {room_id}")
    print("=" * 62)
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
                        print(f"[eli kunju] Room {room_id}: {msg.get('mobileCount', 0)} phone(s) connected")
                    else:
                        apply_command(msg)
        except KeyboardInterrupt:
            return
        except Exception as err:
            print(f"[eli kunju] Reconnecting in 2s ({err})...")
            await asyncio.sleep(2)


def main():
    parser = argparse.ArgumentParser(description="eli kunju Mobile Hotspot Desktop Bridge")
    parser.add_argument("--relay", action="store_true", help="Use Room Pairing relay instead of direct Mobile Hotspot")
    parser.add_argument("--room", default=DEFAULT_ROOM, help="4-digit pairing room code (for --relay mode)")
    parser.add_argument("--url", default=DEFAULT_RELAY_URL, help="WebSocket relay URL")
    args = parser.parse_args()

    try:
        if args.relay:
            asyncio.run(run_relay_mode(args.url, args.room.upper()))
        else:
            asyncio.run(run_hotspot_mode())
    except KeyboardInterrupt:
        print("\\n[eli kunju] Stopped.")


if __name__ == "__main__":
    main()
`;
}
