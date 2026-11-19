import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Download, MousePointer2, RefreshCw, Smartphone } from 'lucide-react';
import type { MouseCommand } from '../types/mouse';
import type { SocketStatus } from '../hooks/useMouseSocket';
import { PWAInstallButton } from './PWAInstallButton';
import { PairingQRCode } from './PairingQRCode';

interface DesktopReceiverProps {
  roomId: string;
  onRefreshRoom: () => void;
  socketStatus: SocketStatus;
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
  mobileCount,
  latencyMs,
  lanAddresses,
  onSwitchToMobile,
  registerCommandHandler,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scrollPaneRef = useRef<HTMLDivElement | null>(null);

  const [cursor, setCursor] = useState({ x: 360, y: 260, pressed: false });
  const cursorRef = useRef({ x: 360, y: 260, pressed: false });
  const downOriginRef = useRef<{ x: number; y: number; button: 'left' | 'right' } | null>(null);

  const [clickMarkers, setClickMarkers] = useState<ClickMarker[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [clickCounts, setClickCounts] = useState({ left: 0, right: 0, double: 0 });
  const [activeTile, setActiveTile] = useState<string | null>(null);
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

  const triggerRemoteClick = useCallback((x: number, y: number, button: 'left' | 'right', isDouble = false) => {
    const id = ++markerIdRef.current;
    setClickMarkers((prev) => [...prev.slice(-5), { id, x, y, button }]);
    window.setTimeout(() => {
      setClickMarkers((prev) => prev.filter((m) => m.id !== id));
    }, 320);

    if (button === 'right') {
      setContextMenu({ x, y });
      setClickCounts((c) => ({ ...c, right: c.right + 1 }));
      return;
    }

    setContextMenu(null);
    setClickCounts((c) => ({
      ...c,
      left: c.left + 1,
      double: isDouble ? c.double + 1 : c.double,
    }));

    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + x, rect.top + y) as HTMLElement | null;
    const tile = target?.closest('[data-test-tile]') as HTMLElement | null;
    if (tile) {
      setActiveTile(tile.dataset.testTile ?? null);
    }
  }, []);

  useEffect(() => {
    registerCommandHandler((cmd) => {
      const stage = stageRef.current;
      const bounds = stage?.getBoundingClientRect();
      const maxW = bounds ? bounds.width - 12 : 900;
      const maxH = bounds ? bounds.height - 12 : 600;

      if (cmd.type === 'move') {
        const nextX = Math.max(8, Math.min(maxW, cursorRef.current.x + cmd.dx));
        const nextY = Math.max(8, Math.min(maxH, cursorRef.current.y + cmd.dy));
        cursorRef.current = { ...cursorRef.current, x: nextX, y: nextY };
        setCursor({ ...cursorRef.current });
      } else if (cmd.type === 'click') {
        triggerRemoteClick(cursorRef.current.x, cursorRef.current.y, cmd.button, false);
      } else if (cmd.type === 'dblclick') {
        triggerRemoteClick(cursorRef.current.x, cursorRef.current.y, cmd.button, true);
      } else if (cmd.type === 'down') {
        downOriginRef.current = { x: cursorRef.current.x, y: cursorRef.current.y, button: cmd.button };
        cursorRef.current = { ...cursorRef.current, pressed: true };
        setCursor({ ...cursorRef.current });
      } else if (cmd.type === 'up') {
        cursorRef.current = { ...cursorRef.current, pressed: false };
        setCursor({ ...cursorRef.current });
        const origin = downOriginRef.current;
        downOriginRef.current = null;
        if (origin && Math.hypot(cursorRef.current.x - origin.x, cursorRef.current.y - origin.y) < 6) {
          triggerRemoteClick(cursorRef.current.x, cursorRef.current.y, cmd.button, false);
        }
      } else if (cmd.type === 'scroll') {
        if (scrollPaneRef.current) {
          scrollPaneRef.current.scrollBy({ top: cmd.dy * 6, left: cmd.dx * 6, behavior: 'auto' });
        }
      }
    });
  }, [registerCommandHandler, triggerRemoteClick]);

  return (
    <div className="min-h-[100dvh] w-full bg-[#101827] text-slate-100 flex flex-col">
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
          <span>
            {mobileCount > 0
              ? `Phone Connected${latencyMs !== null ? ` (${latencyMs} ms)` : ''}`
              : socketStatus === 'connected'
              ? 'Scan QR from any mobile to control'
              : 'Connecting…'}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton compact />
          <button
            type="button"
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
                Scan this QR using your phone camera or the scanner icon inside eli kunju. Whichever phone scans it becomes your live mouse.
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
              <p className="mt-2 text-xs text-slate-400">
                {mobileCount > 0 ? 'Mobile paired — ready to move' : 'Waiting for mobile scan…'}
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
              <span>Optional: Control OS cursor outside browser</span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180 shrink-0" />
            </summary>
            <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                Web browsers keep the pointer inside this tab for security. If you want to move your system-wide laptop cursor outside the browser, run a bridge script with room <span className="font-mono-num text-slate-200">{roomId}</span>.
              </p>
              {lanAddresses.length > 0 && (
                <p className="text-xs text-slate-400">
                  Local IP: <span className="font-mono-num text-slate-300">{lanAddresses[0]}</span>
                </p>
              )}
              <a
                href={`/api/desktop-bridge/hotspot?room=${encodeURIComponent(roomId)}`}
                download="eli-kunju-hotspot.py"
                className="inline-flex w-full min-h-[40px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-[#0E1524] px-3 text-xs font-medium text-slate-200 hover:border-[#C78E65]/70 whitespace-nowrap transition-colors"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Hotspot Bridge (.py)</span>
              </a>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`/api/desktop-bridge/python?room=${encodeURIComponent(roomId)}`}
                  download="eli-kunju-bridge.py"
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-[#0E1524] px-3 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap transition-colors"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Python</span>
                </a>
                <a
                  href={`/api/desktop-bridge/node?room=${encodeURIComponent(roomId)}`}
                  download="eli-kunju-bridge.mjs"
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-[#0E1524] px-3 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap transition-colors"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Node.js</span>
                </a>
              </div>
            </div>
          </details>
        </aside>

        {/* Right column: Live Interactive Cursor Stage */}
        <section
          ref={stageRef}
          onClick={() => setContextMenu(null)}
          className="relative min-h-[520px] overflow-hidden rounded-2xl border border-slate-800 bg-[#0E1524] p-6 lg:col-span-8 flex flex-col gap-6"
        >
          <div className="flex items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                Live Cursor Stage
              </h2>
              <p className="text-xs text-slate-400">
                Move your scanned mobile or slide its screen to glide the cursor, tap Left/Right Click, and drag the Mouse Head to scroll.
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
                      ? 'border-[#C78E65] bg-[#C78E65]/15 text-slate-100'
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
              className="h-[340px] overflow-y-auto rounded-xl border border-slate-800 bg-[#151F32] p-5 space-y-4"
            >
              <h3 className="text-xs font-medium text-[#C78E65]">Mouse Head Scroll Surface</h3>
              {Array.from({ length: 14 }, (_, idx) => (
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

          {/* Right-click context menu preview */}
          {contextMenu && (
            <div
              style={{
                left: Math.min(contextMenu.x, (stageRef.current?.clientWidth ?? 600) - 170),
                top: Math.min(contextMenu.y, (stageRef.current?.clientHeight ?? 480) - 130),
              }}
              className="absolute z-20 w-40 rounded-xl border border-slate-700 bg-[#192439] py-1.5 shadow-2xl text-xs text-slate-200"
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

          {/* Click ripple markers */}
          {clickMarkers.map((m) => (
            <span
              key={m.id}
              style={{ left: m.x, top: m.y }}
              className={`pointer-events-none absolute z-20 h-10 w-10 rounded-full border-2 animate-mouse-ripple ${
                m.button === 'left'
                  ? 'border-[#C78E65] bg-[#C78E65]/20'
                  : 'border-sky-400 bg-sky-400/20'
              }`}
            />
          ))}

          {/* Live remote cursor */}
          <div
            style={{
              transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0) scale(${cursor.pressed ? 0.9 : 1})`,
            }}
            className="pointer-events-none absolute left-0 top-0 z-30 will-change-transform transition-transform duration-75"
          >
            <MousePointer2
              className="w-6 h-6 -translate-x-1 -translate-y-1 text-[#C78E65] fill-[#101827] drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)]"
              strokeWidth={2.2}
            />
          </div>
        </section>
      </main>
    </div>
  );
};
