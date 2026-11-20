export function buildClientWindowsBatBridgeScript(roomId: string): string {
  const safeRoom = roomId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || '4821';
  // Pure zero-install Windows 10/11 launcher: uses built-in PowerShell + .NET ClientWebSocket + Win32 user32.dll.
  // No Python, no Node.js, no pip/npm install required — double-click to control your ENTIRE laptop!
  return [
    '@echo off',
    'setlocal',
    `title eli kunju - Full Laptop Mouse (Room ${safeRoom})`,
    'echo.',
    `echo [eli kunju] Starting Full Laptop Mouse Enabler for Room ${safeRoom}...`,
    'echo [1/2] Preparing native Windows cursor driver...',
    'set "EK_SELF=%~f0"',
    'set "EK_PS=%TEMP%\\eli_kunju_bridge.ps1"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[System.IO.File]::ReadAllText($env:EK_SELF); $m=\'#PS_\'+\'START#\'; $i=$c.LastIndexOf($m); [System.IO.File]::WriteAllText($env:EK_PS, $c.Substring($i+$m.Length).TrimStart())"',
    'if not exist "%EK_PS%" (',
    '  echo [eli kunju] Failed to prepare script. Please right-click and Run as Administrator.',
    '  pause',
    '  exit /b 1',
    ')',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%EK_PS%"',
    'echo.',
    'echo eli kunju closed. Press any key to exit...',
    'pause >nul',
    'exit /b',
    '#PS_START#',
    `$room = "${safeRoom}"`,
    '[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12',
    "$csharp = @'",
    'using System;',
    'using System.Collections.Generic;',
    'using System.Globalization;',
    'using System.Net.WebSockets;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'using System.Text.RegularExpressions;',
    'using System.Threading;',
    'using System.Threading.Tasks;',
    '',
    'public class EliKunjuWinBridge {',
    '    [StructLayout(LayoutKind.Sequential)]',
    '    public struct POINT { public int X; public int Y; }',
    '',
    '    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();',
    '    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT lpPoint);',
    '    [DllImport("user32.dll")] static extern bool SetCursorPos(int X, int Y);',
    '    [DllImport("user32.dll")] static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);',
    '',
    '    const uint LEFTDOWN = 0x0002;',
    '    const uint LEFTUP = 0x0004;',
    '    const uint RIGHTDOWN = 0x0008;',
    '    const uint RIGHTUP = 0x0010;',
    '    const uint WHEEL = 0x0800;',
    '    const uint HWHEEL = 0x1000;',
    '',
    '    static readonly object moveLock = new object();',
    '    static double pendingX = 0;',
    '    static double pendingY = 0;',
    '    static double remX = 0;',
    '    static double remY = 0;',
    '    static string activeMobile = null;',
    '    static bool announcedMove = false;',
    '',
    '    static readonly Regex RxType = new Regex(@"""type""\\s*:\\s*""([a-zA-Z]+)""", RegexOptions.Compiled);',
    '    static readonly Regex RxButton = new Regex(@"""button""\\s*:\\s*""([a-zA-Z]+)""", RegexOptions.Compiled);',
    '    static readonly Regex RxDx = new Regex(@"""dx""\\s*:\\s*(-?\\d+(?:\\.\\d+)?)", RegexOptions.Compiled);',
    '    static readonly Regex RxDy = new Regex(@"""dy""\\s*:\\s*(-?\\d+(?:\\.\\d+)?)", RegexOptions.Compiled);',
    '    static readonly Regex RxFrom = new Regex(@"""from""\\s*:\\s*""([^""]+)""", RegexOptions.Compiled);',
    '    static readonly Regex RxId = new Regex(@"""id""\\s*:\\s*""([^""]+)""", RegexOptions.Compiled);',
    '    static readonly Regex RxKind = new Regex(@"""kind""\\s*:\\s*""([^""]+)""", RegexOptions.Compiled);',
    '    static readonly Regex RxRole = new Regex(@"""role""\\s*:\\s*""([^""]+)""", RegexOptions.Compiled);',
    '    static readonly Regex RxObj = new Regex(@"\\{[^{}]*""type""[^{}]*\\}", RegexOptions.Compiled);',
    '',
    '    static byte[] EncodeRemLen(int len) {',
    '        var list = new List<byte>();',
    '        do {',
    '            int d = len % 128;',
    '            len /= 128;',
    '            if (len > 0) d |= 0x80;',
    '            list.Add((byte)d);',
    '        } while (len > 0);',
    '        return list.ToArray();',
    '    }',
    '',
    '    static byte[] EncodeStr(string s) {',
    '        byte[] b = Encoding.UTF8.GetBytes(s);',
    '        byte[] r = new byte[b.Length + 2];',
    '        r[0] = (byte)((b.Length >> 8) & 0xFF);',
    '        r[1] = (byte)(b.Length & 0xFF);',
    '        Buffer.BlockCopy(b, 0, r, 2, b.Length);',
    '        return r;',
    '    }',
    '',
    '    static byte[] Concat(params byte[][] parts) {',
    '        int total = 0;',
    '        foreach (var p in parts) total += p.Length;',
    '        byte[] outBuf = new byte[total];',
    '        int off = 0;',
    '        foreach (var p in parts) { Buffer.BlockCopy(p, 0, outBuf, off, p.Length); off += p.Length; }',
    '        return outBuf;',
    '    }',
    '',
    '    static byte[] BuildConnect(string cid) {',
    '        var body = Concat(EncodeStr("MQTT"), new byte[] { 4, 2, 0, 30 }, EncodeStr(cid));',
    '        return Concat(new byte[] { 0x10 }, EncodeRemLen(body.Length), body);',
    '    }',
    '',
    '    static byte[] BuildSubscribe(int pid, string[] topics) {',
    '        var parts = new List<byte[]>();',
    '        parts.Add(new byte[] { (byte)((pid >> 8) & 0xFF), (byte)(pid & 0xFF) });',
    '        foreach (var t in topics) { parts.Add(EncodeStr(t)); parts.Add(new byte[] { 0 }); }',
    '        var body = Concat(parts.ToArray());',
    '        return Concat(new byte[] { 0x82 }, EncodeRemLen(body.Length), body);',
    '    }',
    '',
    '    static byte[] BuildPublish(string topic, string payload) {',
    '        var body = Concat(EncodeStr(topic), Encoding.UTF8.GetBytes(payload));',
    '        return Concat(new byte[] { 0x30 }, EncodeRemLen(body.Length), body);',
    '    }',
    '',
    '    static long NowMs() {',
    '        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;',
    '    }',
    '',
    '    static double ReadNum(Regex rx, string json) {',
    '        var m = rx.Match(json);',
    '        if (!m.Success) return 0;',
    '        double v;',
    '        return double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0;',
    '    }',
    '',
    '    static void MoveByPixels(double dx, double dy) {',
    '        remX += dx;',
    '        remY += dy;',
    '        int ix = (int)Math.Truncate(remX);',
    '        int iy = (int)Math.Truncate(remY);',
    '        remX -= ix;',
    '        remY -= iy;',
    '        if (ix != 0 || iy != 0) {',
    '            POINT p;',
    '            if (GetCursorPos(out p)) SetCursorPos(p.X + ix, p.Y + iy);',
    '        }',
    '    }',
    '',
    '    static void FlushPendingMoveImmediate() {',
    '        double dx = 0, dy = 0;',
    '        lock (moveLock) {',
    '            dx = pendingX; dy = pendingY;',
    '            pendingX = 0; pendingY = 0;',
    '        }',
    '        if (Math.Abs(dx) > 0.01 || Math.Abs(dy) > 0.01) MoveByPixels(dx, dy);',
    '    }',
    '',
    '    static void StartSmoothCursorThread() {',
    '        var t = new Thread(() => {',
    '            while (true) {',
    '                double stepX = 0, stepY = 0;',
    '                lock (moveLock) {',
    '                    if (Math.Abs(pendingX) > 0.02 || Math.Abs(pendingY) > 0.02) {',
    '                        stepX = Math.Abs(pendingX) < 1.0 ? pendingX : pendingX * 0.36;',
    '                        stepY = Math.Abs(pendingY) < 1.0 ? pendingY : pendingY * 0.36;',
    '                        pendingX -= stepX;',
    '                        pendingY -= stepY;',
    '                    }',
    '                }',
    '                if (stepX != 0 || stepY != 0) MoveByPixels(stepX, stepY);',
    '                Thread.Sleep(10);',
    '            }',
    '        });',
    '        t.IsBackground = true;',
    '        t.Start();',
    '    }',
    '',
    '    static void ApplySingleCmd(string obj) {',
    '        var tm = RxType.Match(obj);',
    '        if (!tm.Success) return;',
    '        string kind = tm.Groups[1].Value;',
    '        if (kind == "move") {',
    '            double dx = ReadNum(RxDx, obj);',
    '            double dy = ReadNum(RxDy, obj);',
    '            lock (moveLock) {',
    '                pendingX += dx;',
    '                pendingY += dy;',
    '            }',
    '        } else if (kind == "click" || kind == "dblclick") {',
    '            FlushPendingMoveImmediate();',
    '            bool right = RxButton.Match(obj).Groups[1].Value == "right";',
    '            if (right) { mouse_event(RIGHTDOWN, 0, 0, 0, UIntPtr.Zero); mouse_event(RIGHTUP, 0, 0, 0, UIntPtr.Zero); }',
    '            else { mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero); mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero); }',
    '        } else if (kind == "down") {',
    '            FlushPendingMoveImmediate();',
    '            bool right = RxButton.Match(obj).Groups[1].Value == "right";',
    '            mouse_event(right ? RIGHTDOWN : LEFTDOWN, 0, 0, 0, UIntPtr.Zero);',
    '        } else if (kind == "up") {',
    '            FlushPendingMoveImmediate();',
    '            bool right = RxButton.Match(obj).Groups[1].Value == "right";',
    '            mouse_event(right ? RIGHTUP : LEFTUP, 0, 0, 0, UIntPtr.Zero);',
    '        } else if (kind == "scroll") {',
    '            double dy = ReadNum(RxDy, obj);',
    '            double dx = ReadNum(RxDx, obj);',
    '            int wy = -(int)Math.Round(dy * 24);',
    '            int wx = (int)Math.Round(dx * 24);',
    '            if (wy != 0) mouse_event(WHEEL, 0, 0, wy, UIntPtr.Zero);',
    '            if (wx != 0) mouse_event(HWHEEL, 0, 0, wx, UIntPtr.Zero);',
    '        }',
    '    }',
    '',
    '    public static void Run(string room) {',
    '        try { SetProcessDPIAware(); } catch {}',
    '        StartSmoothCursorThread();',
    '        string cid = "ek_win_" + Guid.NewGuid().ToString("N").Substring(0, 8);',
    '        string presenceTopic = "elikunju/v2/" + room + "/presence";',
    '        string cmdTopic = "elikunju/v2/" + room + "/cmd";',
    '        string[] brokers = new string[] { "wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt" };',
    '        int idx = 0;',
    '',
    '        Console.ForegroundColor = ConsoleColor.Cyan;',
    '        Console.WriteLine("========================================================");',
    '        Console.WriteLine("  eli kunju - Full Laptop Mouse Control (Windows)");',
    '        Console.WriteLine("  Room Code : " + room);',
    '        Console.WriteLine("========================================================");',
    '        Console.ResetColor();',
    '',
    '        while (true) {',
    '            string url = brokers[idx % brokers.Length];',
    '            try {',
    '                using (var ws = new ClientWebSocket()) {',
    '                    ws.Options.AddSubProtocol("mqtt");',
    '                    ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);',
    '                    ws.ConnectAsync(new Uri(url), CancellationToken.None).GetAwaiter().GetResult();',
    '                    var sendLock = new object();',
    '                    Action<byte[]> sendBytes = (bytes) => {',
    '                        lock (sendLock) {',
    '                            if (ws.State == WebSocketState.Open) {',
    '                                ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Binary, true, CancellationToken.None).GetAwaiter().GetResult();',
    '                            }',
    '                        }',
    '                    };',
    '',
    '                    sendBytes(BuildConnect(cid));',
    '',
    '                    var cts = new CancellationTokenSource();',
    '                    bool connAcked = false;',
    '                    var rxBuf = new List<byte>();',
    '                    byte[] recvChunk = new byte[8192];',
    '                    while (ws.State == WebSocketState.Open) {',
    '                        var res = ws.ReceiveAsync(new ArraySegment<byte>(recvChunk), CancellationToken.None).GetAwaiter().GetResult();',
    '                        if (res.MessageType == WebSocketMessageType.Close) break;',
    '                        for (int k = 0; k < res.Count; k++) rxBuf.Add(recvChunk[k]);',
    '',
    '                        while (rxBuf.Count >= 2) {',
    '                            int ptype = (rxBuf[0] >> 4) & 0x0F;',
    '                            int qos = (rxBuf[0] >> 1) & 0x03;',
    '                            int mult = 1, rem = 0, pos = 1;',
    '                            bool completeHeader = false;',
    '                            while (pos < rxBuf.Count) {',
    '                                byte eb = rxBuf[pos++];',
    '                                rem += (eb & 0x7F) * mult;',
    '                                mult *= 128;',
    '                                if ((eb & 0x80) == 0) { completeHeader = true; break; }',
    '                            }',
    '                            if (!completeHeader) break;',
    '                            int total = pos + rem;',
    '                            if (rxBuf.Count < total) break;',
    '                            byte[] frame = rxBuf.GetRange(0, total).ToArray();',
    '                            rxBuf.RemoveRange(0, total);',
    '',
    '                            if (ptype == 2 && !connAcked) {',
    '                                connAcked = true;',
    '                                sendBytes(BuildSubscribe(1, new string[] { presenceTopic, cmdTopic }));',
    '                                Console.ForegroundColor = ConsoleColor.Green;',
    '                                Console.WriteLine("[eli kunju] LIVE! Your scanned phone now controls your ENTIRE laptop.");',
    '                                Console.WriteLine("[eli kunju] Minimize this window and use your phone like a normal mouse anywhere!");',
    '                                Console.ResetColor();',
    '                                Task.Run(async () => {',
    '                                    while (!cts.IsCancellationRequested && ws.State == WebSocketState.Open) {',
    '                                        try {',
    '                                            string hello = "{\\"kind\\":\\"hello\\",\\"role\\":\\"desktop\\",\\"osBridge\\":true,\\"id\\":\\"" + cid + "\\",\\"ts\\":" + NowMs() + "}";',
    '                                            sendBytes(BuildPublish(presenceTopic, hello));',
    '                                            sendBytes(new byte[] { 0xC0, 0x00 });',
    '                                            await Task.Delay(4000, cts.Token);',
    '                                        } catch { break; }',
    '                                    }',
    '                                });',
    '                            } else if (ptype == 3 && rem >= 2) {',
    '                                int tlen = (frame[pos] << 8) | frame[pos + 1];',
    '                                int tstart = pos + 2;',
    '                                if (tstart + tlen > total) continue;',
    '                                string topic = Encoding.UTF8.GetString(frame, tstart, tlen);',
    '                                int pstart = tstart + tlen + (qos > 0 ? 2 : 0);',
    '                                string payload = pstart <= total ? Encoding.UTF8.GetString(frame, pstart, total - pstart) : "";',
    '',
    '                                if (topic == cmdTopic) {',
    '                                    var fm = RxFrom.Match(payload);',
    '                                    string fromId = fm.Success ? fm.Groups[1].Value : null;',
    '                                    if (!string.IsNullOrEmpty(fromId)) {',
    '                                        if (activeMobile == null) activeMobile = fromId;',
    '                                        if (fromId != activeMobile) continue;',
    '                                    }',
    '                                    foreach (Match m in RxObj.Matches(payload)) {',
    '                                        if (!announcedMove) {',
    '                                            announcedMove = true;',
    '                                            Console.ForegroundColor = ConsoleColor.Green;',
    '                                            Console.WriteLine("[eli kunju] Receiving phone movement - your REAL Windows mouse arrow is moving!");',
    '                                            Console.ResetColor();',
    '                                        }',
    '                                        ApplySingleCmd(m.Value);',
    '                                    }',
    '                                } else if (topic == presenceTopic) {',
    '                                    string knd = RxKind.Match(payload).Groups[1].Value;',
    '                                    string pid = RxId.Match(payload).Groups[1].Value;',
    '                                    string role = RxRole.Match(payload).Groups[1].Value;',
    '                                    if (knd == "hello" && pid != cid && role == "mobile") {',
    '                                        if (activeMobile != pid) {',
    '                                            activeMobile = pid;',
    '                                            Console.WriteLine("[eli kunju] Mobile paired & controlling laptop!");',
    '                                        }',
    '                                        string reply = "{\\"kind\\":\\"hello\\",\\"role\\":\\"desktop\\",\\"osBridge\\":true,\\"id\\":\\"" + cid + "\\",\\"ts\\":" + NowMs() + "}";',
    '                                        sendBytes(BuildPublish(presenceTopic, reply));',
    '                                    }',
    '                                }',
    '                            }',
    '                        }',
    '                    }',
    '                    cts.Cancel();',
    '                }',
    '            } catch (Exception ex) {',
    '                Console.WriteLine("[eli kunju] Reconnecting (" + ex.Message + ")...");',
    '                idx++;',
    '                Thread.Sleep(2000);',
    '            }',
    '        }',
    '    }',
    '}',
    "'@",
    'Add-Type -TypeDefinition $csharp -Language CSharp',
    '[EliKunjuWinBridge]::Run($room)',
    '',
  ].join('\r\n');
}

export function buildClientPythonBridgeScript(roomId: string): string {
  const safeRoom = roomId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) || '4821';
  return `#!/usr/bin/env python3
"""
eli kunju Desktop OS Cursor Bridge (macOS / Linux / Windows)
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
rem_x = 0.0
rem_y = 0.0


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
    global rem_x, rem_y
    kind = cmd.get("type")
    if kind == "move":
        rem_x += float(cmd.get("dx", 0))
        rem_y += float(cmd.get("dy", 0))
        ix = int(rem_x)
        iy = int(rem_y)
        rem_x -= ix
        rem_y -= iy
        if ix != 0 or iy != 0:
            pyautogui.moveRel(ix, iy, _pause=False)
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
    active_mobile = None

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
                print(f"[eli kunju] LIVE on room {room}. Your phone now controls your entire laptop!")

                async def keepalive():
                    while True:
                        await ws.send(build_publish(presence_topic, json.dumps({
                            "kind": "hello", "role": "desktop", "osBridge": True, "id": cid, "ts": int(time.time() * 1000)
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
                                    sender = msg.get("from")
                                    if sender:
                                        if active_mobile is None:
                                            active_mobile = sender
                                        if sender != active_mobile:
                                            continue
                                    batch = msg.get("cmds") if isinstance(msg.get("cmds"), list) else ([msg["cmd"]] if isinstance(msg.get("cmd"), dict) else [])
                                    for c in batch:
                                        if isinstance(c, dict):
                                            apply_command(c)
                                elif topic == presence_topic and msg.get("kind") == "hello" and msg.get("id") != cid and msg.get("role") == "mobile":
                                    active_mobile = msg.get("id")
                                    await ws.send(build_publish(presence_topic, json.dumps({
                                        "kind": "hello", "role": "desktop", "osBridge": True, "id": cid, "ts": int(time.time() * 1000)
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
 * eli kunju Desktop OS Cursor Bridge (Node.js)
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
let activeMobile = null;
function connect() {
  const url = BROKERS[brokerIdx % BROKERS.length];
  const ws = new WebSocket(url, ['mqtt']);
  let timer = null;
  let rx = Buffer.alloc(0);

  ws.on('open', () => {
    ws.send(pktConnect());
    ws.send(pktSub([presenceTopic, cmdTopic]));
    console.log(\`[eli kunju] LIVE on room \${room}. Your phone now controls your entire laptop!\`);
    const announce = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(pktPub(presenceTopic, { kind: 'hello', role: 'desktop', osBridge: true, id: cid, ts: Date.now() }));
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
            if (msg.from) {
              if (!activeMobile) activeMobile = msg.from;
              if (msg.from !== activeMobile) continue;
            }
            const batch = Array.isArray(msg.cmds) ? msg.cmds : msg.cmd ? [msg.cmd] : [];
            for (const c of batch) { await applyCommand(c); }
          } else if (topic === presenceTopic && msg.kind === 'hello' && msg.id !== cid && msg.role === 'mobile') {
            activeMobile = msg.id;
            ws.send(pktPub(presenceTopic, { kind: 'hello', role: 'desktop', osBridge: true, id: cid, ts: Date.now() }));
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
