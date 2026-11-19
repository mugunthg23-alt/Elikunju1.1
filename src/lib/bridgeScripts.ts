export function buildClientPythonBridgeScript(roomId: string): string {
  const safeRoom = roomId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || '4821';
  return `#!/usr/bin/env python3
"""
eli kunju Desktop OS Cursor Bridge (Works with Netlify & Cloud hosting!)
Moves your real Windows, macOS, or Linux system cursor from your scanned phone.

Setup (run once):
  pip install websockets pyautogui

Run:
  python eli-kunju-bridge.py
  python eli-kunju-bridge.py --room ${safeRoom}
"""

import argparse
import asyncio
import json
import random
import string
import sys
import time

try:
    import websockets
    import pyautogui
except ImportError:
    print("Missing dependencies. Run: pip install websockets pyautogui")
    sys.exit(1)

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
]
DEFAULT_ROOM = ${JSON.stringify(safeRoom)}


def encode_rem_len(n: int) -> bytes:
    out = bytearray()
    while True:
        d = n % 128
        n //= 128
        if n > 0:
            d |= 0x80
        out.append(d)
        if n == 0:
            break
    return bytes(out)


def encode_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return len(b).to_bytes(2, "big") + b


def build_connect(cid: str) -> bytes:
    body = encode_str("MQTT") + bytes([4, 2, 0, 30]) + encode_str(cid)
    return bytes([0x10]) + encode_rem_len(len(body)) + body


def build_subscribe(pid: int, topics: list[str]) -> bytes:
    body = pid.to_bytes(2, "big") + b"".join(encode_str(t) + b"\\x00" for t in topics)
    return bytes([0x82]) + encode_rem_len(len(body)) + body


def build_publish(topic: str, payload: str) -> bytes:
    body = encode_str(topic) + payload.encode("utf-8")
    return bytes([0x30]) + encode_rem_len(len(body)) + body


def parse_packets(buf: bytearray):
    packets = []
    while len(buf) >= 2:
        ptype = (buf[0] >> 4) & 0x0F
        qos = (buf[0] >> 1) & 0x03
        mult = 1
        rem = 0
        idx = 1
        while True:
            if idx >= len(buf):
                return packets
            eb = buf[idx]
            idx += 1
            rem += (eb & 0x7F) * mult
            mult *= 128
            if (eb & 0x80) == 0:
                break
        total = idx + rem
        if len(buf) < total:
            return packets
        frame = bytes(buf[:total])
        del buf[:total]
        if ptype == 3 and rem >= 2:
            tlen = int.from_bytes(frame[idx : idx + 2], "big")
            tstart = idx + 2
            tend = tstart + tlen
            topic = frame[tstart:tend].decode("utf-8", errors="ignore")
            pstart = tend + (2 if qos > 0 else 0)
            payload = frame[pstart:total].decode("utf-8", errors="ignore")
            packets.append((ptype, topic, payload))
        else:
            packets.append((ptype, "", ""))
    return packets


def apply_command(cmd: dict) -> None:
    kind = cmd.get("type")
    if kind == "move":
        dx = float(cmd.get("dx", 0))
        dy = float(cmd.get("dy", 0))
        if dx != 0 or dy != 0:
            pyautogui.moveRel(dx, dy, _pause=False)
    elif kind in ("click", "dblclick"):
        btn = "right" if cmd.get("button") == "right" else "left"
        pyautogui.click(button=btn, _pause=False)
    elif kind == "down":
        btn = "right" if cmd.get("button") == "right" else "left"
        pyautogui.mouseDown(button=btn, _pause=False)
    elif kind == "up":
        btn = "right" if cmd.get("button") == "right" else "left"
        pyautogui.mouseUp(button=btn, _pause=False)
    elif kind == "scroll":
        dy = float(cmd.get("dy", 0))
        if dy != 0:
            pyautogui.scroll(int(round(-dy * 4)), _pause=False)


async def run_bridge(room: str):
    cid = "ek_py_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    presence_topic = f"elikunju/v2/{room}/presence"
    cmd_topic = f"elikunju/v2/{room}/cmd"
    broker_idx = 0

    print("=" * 58)
    print(" eli kunju Desktop OS Cursor Bridge")
    print(f" Room Code : {room}")
    print(" Scan the laptop QR (or enter this code) on your phone.")
    print(" Press Ctrl+C to stop.")
    print("=" * 58)

    while True:
        url = BROKERS[broker_idx % len(BROKERS)]
        try:
            async with websockets.connect(url, subprotocols=["mqtt"], ping_interval=None) as ws:
                await ws.send(build_connect(cid))
                await ws.send(build_subscribe(1, [presence_topic, cmd_topic]))
                print(f"[eli kunju] Connected to room {room}. Move your phone to move the OS cursor.")

                async def keepalive():
                    while True:
                        await ws.send(build_publish(presence_topic, json.dumps({
                            "kind": "hello", "role": "desktop", "id": cid, "ts": int(time.time() * 1000)
                        })))
                        await asyncio.sleep(4)
                        await ws.send(bytes([0xC0, 0x00]))

                ka_task = asyncio.create_task(keepalive())
                buf = bytearray()
                try:
                    async for raw in ws:
                        if isinstance(raw, bytes):
                            buf.extend(raw)
                            for ptype, topic, payload in parse_packets(buf):
                                if ptype != 3 or not payload:
                                    continue
                                try:
                                    msg = json.loads(payload)
                                except Exception:
                                    continue
                                if topic == cmd_topic:
                                    batch = msg.get("cmds") if isinstance(msg.get("cmds"), list) else ([msg["cmd"]] if isinstance(msg.get("cmd"), dict) else [])
                                    for c in batch:
                                        if isinstance(c, dict):
                                            apply_command(c)
                                elif topic == presence_topic and msg.get("kind") == "hello" and msg.get("id") != cid:
                                    await ws.send(build_publish(presence_topic, json.dumps({
                                        "kind": "hello", "role": "desktop", "id": cid, "ts": int(time.time() * 1000)
                                    })))
                finally:
                    ka_task.cancel()
        except KeyboardInterrupt:
            return
        except Exception as err:
            print(f"[eli kunju] Reconnecting ({err})...")
            broker_idx += 1
            await asyncio.sleep(2)


def main():
    parser = argparse.ArgumentParser(description="eli kunju OS Cursor Bridge")
    parser.add_argument("--room", default=DEFAULT_ROOM, help="4-digit room code")
    args = parser.parse_args()
    try:
        asyncio.run(run_bridge(args.room.upper()))
    except KeyboardInterrupt:
        print("\\n[eli kunju] Stopped.")


if __name__ == "__main__":
    main()
`;
}

export function buildClientNodeBridgeScript(roomId: string): string {
  const safeRoom = roomId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || '4821';
  return `#!/usr/bin/env node
/**
 * eli kunju Desktop OS Cursor Bridge (Node.js — works with Netlify & Cloud hosting!)
 *
 * Setup (run once):
 *   npm install ws @nut-tree-fork/nut-js
 *
 * Run:
 *   node eli-kunju-bridge.mjs
 *   node eli-kunju-bridge.mjs --room ${safeRoom}
 */
import { WebSocket } from 'ws';
import { mouse, Button, Point } from '@nut-tree-fork/nut-js';

mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 3000;

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];
const args = process.argv.slice(2);
const rIdx = args.indexOf('--room');
const room = (rIdx >= 0 && args[rIdx + 1] ? args[rIdx + 1] : ${JSON.stringify(safeRoom)}).toUpperCase();
const cid = 'ek_js_' + Math.random().toString(36).slice(2, 10);
const presenceTopic = \`elikunju/v2/\${room}/presence\`;
const cmdTopic = \`elikunju/v2/\${room}/cmd\`;

const encRem = (n) => {
  const b = [];
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 0x80; b.push(d); } while (n > 0);
  return Buffer.from(b);
};
const encStr = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([(b.length >> 8) & 255, b.length & 255]), b]); };
const pktConnect = () => { const b = Buffer.concat([encStr('MQTT'), Buffer.from([4, 2, 0, 30]), encStr(cid)]); return Buffer.concat([Buffer.from([0x10]), encRem(b.length), b]); };
const pktSub = (topics) => { const b = Buffer.concat([Buffer.from([0, 1]), ...topics.map((t) => Buffer.concat([encStr(t), Buffer.from([0])]))]); return Buffer.concat([Buffer.from([0x82]), encRem(b.length), b]); };
const pktPub = (topic, obj) => { const b = Buffer.concat([encStr(topic), Buffer.from(JSON.stringify(obj), 'utf8')]); return Buffer.concat([Buffer.from([0x30]), encRem(b.length), b]); };

async function applyCommand(cmd) {
  if (cmd.type === 'move') {
    const pos = await mouse.getPosition();
    await mouse.setPosition(new Point(Math.round(pos.x + cmd.dx), Math.round(pos.y + cmd.dy)));
  } else if (cmd.type === 'click' || cmd.type === 'dblclick') {
    await mouse.click(cmd.button === 'right' ? Button.RIGHT : Button.LEFT);
  } else if (cmd.type === 'down') {
    await mouse.pressButton(cmd.button === 'right' ? Button.RIGHT : Button.LEFT);
  } else if (cmd.type === 'up') {
    await mouse.releaseButton(cmd.button === 'right' ? Button.RIGHT : Button.LEFT);
  } else if (cmd.type === 'scroll') {
    const amt = Math.round(Math.abs(cmd.dy) * 3);
    if (amt > 0) { if (cmd.dy > 0) await mouse.scrollDown(amt); else await mouse.scrollUp(amt); }
  }
}

let brokerIdx = 0;
function connect() {
  const url = BROKERS[brokerIdx % BROKERS.length];
  const ws = new WebSocket(url, ['mqtt']);
  let timer = null;
  let rx = Buffer.alloc(0);

  ws.on('open', () => {
    ws.send(pktConnect());
    ws.send(pktSub([presenceTopic, cmdTopic]));
    console.log(\`[eli kunju] Connected to room \${room}. Ready for phone OS cursor control.\`);
    const announce = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(pktPub(presenceTopic, { kind: 'hello', role: 'desktop', id: cid, ts: Date.now() }));
        ws.send(Buffer.from([0xc0, 0x00]));
      }
    };
    announce();
    timer = setInterval(announce, 4000);
  });

  ws.on('message', async (data) => {
    rx = Buffer.concat([rx, Buffer.from(data)]);
    while (rx.length >= 2) {
      const ptype = (rx[0] >> 4) & 15;
      const qos = (rx[0] >> 1) & 3;
      let mult = 1, rem = 0, idx = 1, eb = 0;
      do { if (idx >= rx.length) return; eb = rx[idx++]; rem += (eb & 127) * mult; mult *= 128; } while (eb & 128);
      const total = idx + rem;
      if (rx.length < total) return;
      const frame = rx.subarray(0, total);
      rx = rx.subarray(total);
      if (ptype === 3 && rem >= 2) {
        const tlen = (frame[idx] << 8) | frame[idx + 1];
        const topic = frame.subarray(idx + 2, idx + 2 + tlen).toString('utf8');
        const payload = frame.subarray(idx + 2 + tlen + (qos > 0 ? 2 : 0), total).toString('utf8');
        try {
          const msg = JSON.parse(payload);
          if (topic === cmdTopic) {
            const batch = Array.isArray(msg.cmds) ? msg.cmds : msg.cmd ? [msg.cmd] : [];
            for (const c of batch) { await applyCommand(c); }
          }
          else if (topic === presenceTopic && msg.kind === 'hello' && msg.id !== cid) {
            ws.send(pktPub(presenceTopic, { kind: 'hello', role: 'desktop', id: cid, ts: Date.now() }));
          }
        } catch {}
      }
    }
  });

  ws.on('close', () => {
    if (timer) clearInterval(timer);
    brokerIdx += 1;
    setTimeout(connect, 2000);
  });
  ws.on('error', () => ws.close());
}

console.log(\`[eli kunju] Starting OS Cursor Bridge for room \${room}...\`);
connect();
`;
}

export function triggerTextFileDownload(filename: string, content: string, mimeType = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
