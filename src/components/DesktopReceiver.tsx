import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Download, MousePointer2, RefreshCw, Smartphone } from 'lucide-react';
import type { MouseCommand } from '../types/mouse';
import type { SocketStatus, TransportKind } from '../hooks/useMouseSocket';
import {
  buildClientNodeBridgeScript,
  buildClientPythonBridgeScript,
  triggerTextFileDownload,
} from '../lib/bridgeScripts';
import { PWAInstallButton } from './PWAInstallButton';
import { PairingQRCode } from './PairingQRCode';

interface DesktopReceiverProps {
  roomId: string;
  onRefreshRoom: () => void;
  socketStatus: SocketStatus;
  transport: TransportKind;
  mobileCount: number;
  latencyMs: number | null;
  lanAddresses: string[];
  onSwitchToMobile: () => void;
  registerCommandHandler: (handler: (cmd: MouseCommand) => void) => void;
}

interface ClickMarker {
  id: number;
  x: number;
  y: number;
  button: 'left' | 'right';
}

export const DesktopReceiver: React.FC<DesktopReceiverProps> = ({
  roomId,
  onRefreshRoom,
  socketStatus,
  transport,
  mobileCount,
  latencyMs,
  lanAddresses,
  onSwitchToMobile,
  registerCommandHandler,
}) => {
  const scrollPaneRef = useRef<HTMLDivElement | null>(null);

  const initialX = typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.62) : 640;
  const initialY = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.46) : 340;

  const [cursor, setCursor] = useState({ x: initialX, y: initialY, pressed: false, active: false });
  const cursorRef = useRef({ x: initialX, y: initialY, pressed: false, active: false });
  const downOriginRef = useRef<{ x: number; y: number; button: 'left' | 'right' } | null>(null);
  const activeTimerRef = useRef<number | null>(null);

  const [clickMarkers, setClickMarkers] = useState<ClickMarker[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [clickCounts, setClickCounts] = useState({ left: 0, right: 0, double: 0 });
  const [activeTile, setActiveTile] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [copiedPhoneUrl, setCopiedPhoneUrl] = useState(false);

  const markerIdRef = useRef(0);

  const phoneUrl = `${window.location.origin}/?mode=mobile&room=${encodeURIComponent(roomId)}`;

  const handleCopyPhoneUrl = async () => {
    try {
      await navigator.clipboard.writeText(phoneUrl);
      setCopiedPhoneUrl(true);
      window.setTimeout(() => setCopiedPhoneUrl(false), 1800);
    } catch {
      // Ignore clipboard rejection
    }
  };

  const pulseCursorActive = useCallback(() => {
    if (!cursorRef.current.active) {
      cursorRef.current = { ...cursorRef.current, active: true };
      setCursor({ ...cursorRef.current });
    }
    if (activeTimerRef.current !== null) {
      window.clearTimeout(activeTimerRef.current);
    }
    activeTimerRef.current = window.setTimeout(() => {
      cursorRef.current = { ...cursorRef.current, active: false };
      setCursor({ ...cursorRef.current });
    }, 350);
  }, []);

  useEffect(() => {
    return () => {
      if (activeTimerRef.current !== null) {
        window.clearTimeout(activeTimerRef.current);
      }
    };
  }, []);

  const triggerRemoteClick = useCallback((x: number, y: number, button: 'left' | 'right', isDouble = false) => {
    const id = ++markerIdRef.current;
    setClickMarkers((prev) => [...prev.slice(-5), { id, x, y, button }]);
    window.setTimeout(() => {
      setClickMarkers((prev) => prev.filter((m) => m.id !== id));
    }, 340);

    if (button === 'right') {
      setContextMenu({ x, y });
      setClickCounts((c) => ({ ...c, right: c.right + 1 }));
      setLastAction('Right Click');
      return;
    }

    setContextMenu(null);
    setClickCounts((c) => ({
      ...c,
      left: c.left + 1,
      double: isDouble ? c.double + 1 : c.double,
    }));
    setLastAction(isDouble ? 'Double Click' : 'Left Click');

    const target = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!target) return;

    const tile = target.closest('[data-test-tile]') as HTMLElement | null;
    if (tile) {
      setActiveTile(tile.dataset.testTile ?? null);
      return;
    }

    // Dispatch genuine clicks to interactive controls anywhere on the page
    const clickable = target.closest('button, a, summary') as HTMLElement | null;
    if (clickable && !clickable.hasAttribute('data-ignore-remote-click')) {
      clickable.click();
    }
  }, []);

  useEffect(() => {
    registerCommandHandler((cmd) => {
      const maxW = Math.max(320, window.innerWidth - 16);
      const maxH = Math.max(320, window.innerHeight - 16);

      pulseCursorActive();

      if (cmd.type === 'move') {
        const nextX = Math.max(8, Math.min(maxW, cursorRef.current.x + cmd.dx));
        const nextY = Math.max(8, Math.min(maxH, cursorRef.current.y + cmd.dy));
        cursorRef.current = { ...cursorRef.current, x: nextX, y: nextY, active: true };
        setCursor({ ...cursorRef.current });
        setLastAction(cmd.source === 'motion' ? 'Phone Motion' : 'Touch Move');
      } else if (cmd.type === 'click') {
        triggerRemoteClick(cursorRef.current.x, cursorRef.current.y, cmd.button, false);
      } else if (cmd.type === 'dblclick') {
        triggerRemoteClick(cursorRef.current.x, cursorRef.current.y, cmd.button, true);
      } else if (cmd.type === 'down') {
        downOriginRef.current = { x: cursorRef.current.x, y: cursorRef.current.y, button: cmd.button };
        cursorRef.current = { ...cursorRef.current, pressed: true };
        setCursor({ ...cursorRef.current });
        setLastAction(cmd.button === 'right' ? 'Right Hold' : 'Left Hold');
      } else if (cmd.type === 'up') {
        cursorRef.current = { ...cursorRef.current, pressed: false };
        setCursor({ ...cursorRef.current });
        const origin = downOriginRef.current;
        downOriginRef.current = null;
        if (origin && Math.hypot(cursorRef.current.x - origin.x, cursorRef.current.y - origin.y) < 8) {
          triggerRemoteClick(cursorRef.current.x, cursorRef.current.y, cmd.button, false);
        }
      } else if (cmd.type === 'scroll') {
        setLastAction('Head Scroll');
        const deltaY = cmd.dy * 7;
        const deltaX = cmd.dx * 7;

        // Scroll whichever scrollable container is under the remote cursor, or fallback to scroll pane + window
        const hovered = document.elementFromPoint(cursorRef.current.x, cursorRef.current.y) as HTMLElement | null;
        const hoveredScrollable = hovered?.closest('[data-remote-scroll]') as HTMLElement | null;

        if (hoveredScrollable) {
          hoveredScrollable.scrollBy({ top: deltaY, left: deltaX, behavior: 'auto' });
        } else {
          if (scrollPaneRef.current) {
            scrollPaneRef.current.scrollBy({ top: deltaY, left: deltaX, behavior: 'auto' });
          }
          if (document.documentElement.scrollHeight > window.innerHeight + 8) {
            window.scrollBy({ top: deltaY, left: deltaX, behavior: 'auto' });
          }
        }
      }
    });
  }, [registerCommandHandler, triggerRemoteClick, pulseCursorActive]);

  return (
    <div
      className="min-h-[100dvh] w-full bg-[#101827] text-slate-100 flex flex-col"
      onClick={() => setContextMenu(null)}
    >
      {/* Clean 3-zone top bar */}
      <header className="flex items-center justify-between gap-8 border-b border-slate-800/90 px-6 py-4">
        <span className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
          eli kunju
        </span>

        <div className="hidden md:flex items-center gap-3 text-xs text-slate-400">
          <span>
            Code <strong className="font-mono-num text-slate-100 ml-1">{roomId}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span className={mobileCount > 0 ? 'text-emerald-300 font-medium' : ''}>
            {mobileCount > 0
              ? `Phone Connected${transport === 'p2p' ? ' · Direct P2P' : ''}${latencyMs !== null ? ` (${latencyMs} ms)` : ''}`
              : socketStatus === 'connected'
              ? 'Scan QR from any mobile to control'
              : 'Connecting…'}
          </span>
          {lastAction && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-[#E7BA96] font-medium">{lastAction}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton compact />
          <button
            type="button"
            data-ignore-remote-click="true"
            onClick={onSwitchToMobile}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 whitespace-nowrap shrink-0 transition-colors"
          >
            <Smartphone className="w-4 h-4 shrink-0" />
            <span>Mouse View</span>
          </button>
        </div>
      </header>

      {/* Main 2-column desktop workspace */}
      <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-12">
        {/* Left column: Scan QR from Mobile to Pair */}
        <aside className="flex flex-col gap-5 lg:col-span-4">
          <div className="rounded-2xl border border-slate-800 bg-[#151F32] p-6 space-y-5">
            <div>
              <h1 className="font-display text-xl font-semibold tracking-tight text-slate-100">
                Scan From Your Mobile
              </h1>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                Scan this QR with your phone camera or inside eli kunju. Whichever phone scans it immediately controls the live cursor on this laptop screen.
              </p>
            </div>

            {/* Scannable QR Code */}
            <div className="flex flex-col items-center rounded-2xl border border-slate-800 bg-[#0E1524] p-5">
              <PairingQRCode value={phoneUrl} size={196} />
              <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
                <span>Code</span>
                <span className="font-mono-num text-base font-semibold tracking-[0.2em] text-[#C78E65]">
                  {roomId}
                </span>
              </div>
              <p
                className={`mt-2 text-xs font-medium ${
                  mobileCount > 0 ? 'text-emerald-300' : 'text-slate-400'
                }`}
              >
                {mobileCount > 0
                  ? `Mobile live — move phone, tap sides, or drag head`
                  : 'Waiting for mobile scan…'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleCopyPhoneUrl}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 text-xs font-medium text-slate-100 hover:bg-slate-700 whitespace-nowrap transition-colors"
              >
                {copiedPhoneUrl ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
                <span>{copiedPhoneUrl ? 'Link Copied' : 'Copy Link'}</span>
              </button>
              <button
                type="button"
                onClick={onRefreshRoom}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-[#0E1524] px-3 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap transition-colors"
              >
                <RefreshCw className="w-4 h-4 shrink-0" />
                <span>New QR</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 border-t border-slate-800 pt-4 text-center">
              <div>
                <p className="font-mono-num text-xl font-semibold text-slate-100">{clickCounts.left}</p>
                <p className="mt-0.5 text-xs text-slate-400">Left Click</p>
              </div>
              <div>
                <p className="font-mono-num text-xl font-semibold text-slate-100">{clickCounts.right}</p>
                <p className="mt-0.5 text-xs text-slate-400">Right Click</p>
              </div>
              <div>
                <p className="font-mono-num text-xl font-semibold text-slate-100">{clickCounts.double}</p>
                <p className="mt-0.5 text-xs text-slate-400">Double</p>
              </div>
            </div>
          </div>

          {/* Optional advanced bridge tucked cleanly inside a collapsible section */}
          <details className="group rounded-2xl border border-slate-800 bg-[#151F32] px-6 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-slate-300">
              <span>Optional: Move Windows/Mac OS cursor outside browser</span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180 shrink-0" />
            </summary>
            <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                For security, web browsers only move the cursor inside this browser window. To move your system-wide Windows/macOS arrow across other apps, run a bridge script with room <span className="font-mono-num text-slate-200">{roomId}</span>.
              </p>
              {lanAddresses.length > 0 && (
                <p className="text-xs text-slate-400">
                  Local IP: <span className="font-mono-num text-slate-300">{lanAddresses[0]}</span>
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    triggerTextFileDownload(
                      'eli-kunju-bridge.py',
                      buildClientPythonBridgeScript(roomId),
                      'text/x-python;charset=utf-8'
                    )
                  }
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-[#0E1524] px-3 text-xs font-medium text-slate-200 hover:border-[#C78E65]/70 hover:bg-slate-800 whitespace-nowrap transition-colors"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Python (.py)</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerTextFileDownload(
                      'eli-kunju-bridge.mjs',
                      buildClientNodeBridgeScript(roomId),
                      'application/javascript;charset=utf-8'
                    )
                  }
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-[#0E1524] px-3 text-xs font-medium text-slate-200 hover:border-[#C78E65]/70 hover:bg-slate-800 whitespace-nowrap transition-colors"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Node.js (.mjs)</span>
                </button>
              </div>
              <p className="font-mono-num text-[11px] text-slate-400">
                Run: <span className="text-slate-200">pip install websockets pyautogui</span> then <span className="text-slate-200">python eli-kunju-bridge.py</span>
              </p>
            </div>
          </details>
        </aside>

        {/* Right column: Live Interactive Cursor Stage */}
        <section className="relative min-h-[520px] overflow-hidden rounded-2xl border border-slate-800 bg-[#0E1524] p-6 lg:col-span-8 flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                Live Cursor Stage
              </h2>
              <p className="text-xs text-slate-400">
                Tilt/move your phone or slide its screen to glide the cursor across this window. Tap left/right sides to click and drag the mouse head to scroll.
              </p>
            </div>
            <span className="font-mono-num text-xs text-slate-400 whitespace-nowrap shrink-0">
              {Math.round(cursor.x)}, {Math.round(cursor.y)}
            </span>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-5 md:grid-cols-2">
            {/* Click targets */}
            <div className="grid grid-cols-2 gap-3 content-start">
              {['Documents', 'Browser', 'Media', 'Terminal'].map((label) => (
                <div
                  key={label}
                  data-test-tile={label}
                  className={`rounded-xl border p-4 transition-colors ${
                    activeTile === label
                      ? 'border-[#C78E65] bg-[#C78E65]/20 text-slate-100'
                      : 'border-slate-800 bg-[#151F32] text-slate-300'
                  }`}
                >
                  <p className="text-sm font-medium">{label}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {activeTile === label ? 'Selected' : 'Left click target'}
                  </p>
                </div>
              ))}
            </div>

            {/* Mouse Head Scroll test pane */}
            <div
              ref={scrollPaneRef}
              data-remote-scroll="true"
              className="h-[340px] overflow-y-auto rounded-xl border border-slate-800 bg-[#151F32] p-5 space-y-4"
            >
              <h3 className="text-xs font-medium text-[#C78E65]">Mouse Head Scroll Surface</h3>
              {Array.from({ length: 16 }, (_, idx) => (
                <div key={idx} className="border-b border-slate-800/70 pb-3 last:border-b-0">
                  <p className="text-sm font-medium text-slate-200">
                    {String(idx + 1).padStart(2, '0')}. Scroll Checkpoint
                  </p>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    Drag your finger up or down across the mouse head on your phone to scroll smoothly.
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Right-click context menu anywhere in viewport */}
      {contextMenu && (
        <div
          style={{
            left: Math.max(12, Math.min(contextMenu.x, window.innerWidth - 180)),
            top: Math.max(12, Math.min(contextMenu.y, window.innerHeight - 140)),
          }}
          className="fixed z-40 w-40 rounded-xl border border-slate-700 bg-[#192439] py-1.5 shadow-2xl text-xs text-slate-200"
        >
          <button
            type="button"
            onClick={() => setContextMenu(null)}
            className="block w-full px-3.5 py-2 text-left hover:bg-slate-800"
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => setContextMenu(null)}
            className="block w-full px-3.5 py-2 text-left hover:bg-slate-800"
          >
            Copy Link
          </button>
          <button
            type="button"
            onClick={() => setContextMenu(null)}
            className="block w-full px-3.5 py-2 text-left hover:bg-slate-800"
          >
            Inspect
          </button>
        </div>
      )}

      {/* Full-window live remote cursor + click ripples */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        {clickMarkers.map((m) => (
          <span
            key={m.id}
            style={{ left: m.x, top: m.y }}
            className={`pointer-events-none absolute h-12 w-12 rounded-full border-2 animate-mouse-ripple ${
              m.button === 'left'
                ? 'border-[#F7DFC9] bg-[#C78E65]/25'
                : 'border-sky-400 bg-sky-400/25'
            }`}
          />
        ))}

        <div
          style={{
            transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0) scale(${cursor.pressed ? 0.88 : 1})`,
          }}
          className="pointer-events-none absolute left-0 top-0 will-change-transform transition-transform duration-75"
        >
          {cursor.active && (
            <span className="absolute -left-2.5 -top-2.5 h-8 w-8 rounded-full bg-[#C78E65]/25 blur-[2px]" />
          )}
          <MousePointer2
            className="relative h-7 w-7 -translate-x-1 -translate-y-1 text-white fill-[#C78E65] drop-shadow-[0_3px_10px_rgba(0,0,0,0.85)]"
            strokeWidth={2}
          />
        </div>
      </div>
    </div>
  );
};
