import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  Download,
  Laptop,
  Move,
  QrCode,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';
import type { ClientRole, MousePreferences } from '../types/mouse';
import type { SocketStatus } from '../hooks/useMouseSocket';
import type { MotionPermissionState } from '../hooks/usePhoneMotion';
import { PWAInstallButton } from './PWAInstallButton';

interface ConnectionDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenScanner: () => void;
  role: ClientRole;
  onRoleChange: (role: ClientRole) => void;
  preferences: MousePreferences;
  onPreferencesChange: (patch: Partial<MousePreferences>) => void;
  socketStatus: SocketStatus;
  peerCounts: { mobile: number; desktop: number };
  latencyMs: number | null;
  errorDetail: string | null;
  motionState: MotionPermissionState;
  onToggleMotion: (next: boolean) => Promise<void>;
  onRecenterMotion: () => void;
  onReplayGuide: () => void;
  lanAddresses: string[];
}

export const ConnectionDrawer: React.FC<ConnectionDrawerProps> = ({
  open,
  onClose,
  onOpenScanner,
  role,
  onRoleChange,
  preferences,
  onPreferencesChange,
  socketStatus,
  peerCounts,
  latencyMs,
  errorDetail,
  motionState,
  onToggleMotion,
  onRecenterMotion,
  onReplayGuide,
  lanAddresses,
}) => {
  const [roomInput, setRoomInput] = useState(preferences.roomId);

  useEffect(() => {
    setRoomInput(preferences.roomId);
  }, [preferences.roomId]);

  if (!open) return null;

  const applyRoomCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = roomInput.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
    if (cleaned.length >= 2) {
      onPreferencesChange({ roomId: cleaned, connectionMode: 'relay' });
      setRoomInput(cleaned);
    }
  };

  const generateNewRoom = () => {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    setRoomInput(code);
    onPreferencesChange({ roomId: code, connectionMode: 'relay' });
  };

  const peerConnected =
    preferences.connectionMode === 'lan'
      ? socketStatus === 'connected'
      : socketStatus === 'connected' && (role === 'mobile' ? peerCounts.desktop > 0 : peerCounts.mobile > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end bg-black/65 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Pair and Mouse Settings"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-h-[88dvh] sm:h-full sm:max-h-none sm:max-w-md overflow-y-auto rounded-t-3xl sm:rounded-none sm:rounded-l-2xl border-t sm:border-t-0 sm:border-l border-slate-700/70 bg-[#151F32] text-slate-100 shadow-2xl"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden pt-3 pb-1">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold tracking-tight text-slate-100">
              eli kunju
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {peerConnected
                ? `Connected to laptop${latencyMs !== null ? ` · ${latencyMs} ms` : ''}`
                : socketStatus === 'connected'
                ? 'Scan laptop QR to connect'
                : 'Connecting…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          {/* Primary Action: Scan Laptop QR */}
          <section className="space-y-3">
            <button
              type="button"
              onClick={onOpenScanner}
              className="inline-flex w-full min-h-[48px] items-center justify-center gap-2.5 rounded-xl bg-[#C78E65] px-4 text-sm font-semibold text-[#101827] hover:bg-[#D59E76] active:scale-[0.98] transition-all whitespace-nowrap"
            >
              <QrCode className="w-4 h-4 shrink-0" />
              <span>Scan Laptop QR Code</span>
            </button>
            <p className="text-xs text-slate-400 leading-relaxed">
              Open eli kunju on your laptop in Laptop Receiver mode and scan its QR code to control it instantly with this phone.
            </p>
          </section>

          {/* Device Mode Switch */}
          <section className="border-t border-slate-800 pt-5">
            <h3 className="text-xs font-medium text-slate-400 mb-2.5">This Device</h3>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#0E1524] p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => onRoleChange('mobile')}
                className={`flex items-center justify-center gap-2 rounded-lg min-h-[44px] px-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  role === 'mobile'
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Smartphone className="w-4 h-4 shrink-0" />
                <span>Mobile Mouse</span>
              </button>
              <button
                type="button"
                onClick={() => onRoleChange('desktop')}
                className={`flex items-center justify-center gap-2 rounded-lg min-h-[44px] px-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  role === 'desktop'
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Laptop className="w-4 h-4 shrink-0" />
                <span>Laptop QR View</span>
              </button>
            </div>
          </section>

          {/* Pairing Code */}
          <section className="space-y-2.5 border-t border-slate-800 pt-5">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-xs font-medium text-slate-400">Pairing Code</h3>
              <span className="font-mono-num text-xs text-slate-400">
                {peerConnected ? 'Paired' : 'Waiting'}
              </span>
            </div>
            <form onSubmit={applyRoomCode} className="flex items-center gap-2">
              <label htmlFor="pm-room-code" className="sr-only">
                Pairing code
              </label>
              <input
                id="pm-room-code"
                type="text"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                maxLength={8}
                placeholder="4821"
                className="font-mono-num min-h-[44px] flex-1 rounded-xl border border-slate-700 bg-[#0E1524] px-3.5 text-base tracking-widest text-slate-100 placeholder:text-slate-500 focus:border-[#C78E65] focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-[44px] rounded-xl bg-slate-800 px-4 text-sm font-medium text-slate-100 hover:bg-slate-700 whitespace-nowrap shrink-0 transition-colors"
              >
                Connect
              </button>
              <button
                type="button"
                onClick={generateNewRoom}
                aria-label="Generate new pairing code"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-700 bg-[#0E1524] text-slate-300 hover:text-white transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </form>
            {errorDetail && (
              <p className="text-xs text-amber-300 leading-relaxed">{errorDetail}</p>
            )}
          </section>

          {/* Phone Movement Tracking */}
          <section className="space-y-3 border-t border-slate-800 pt-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Move className="w-4 h-4 text-[#C78E65] shrink-0" />
                <div>
                  <h3 className="text-sm font-medium text-slate-100">Phone Motion Cursor</h3>
                  <p className="text-xs text-slate-400">Move your phone to glide the laptop cursor</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={preferences.motionEnabled}
                onClick={() => {
                  void onToggleMotion(!preferences.motionEnabled);
                }}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C78E65] ${
                  preferences.motionEnabled ? 'bg-[#C78E65]' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    preferences.motionEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {preferences.motionEnabled && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-xs text-slate-400">
                  {motionState === 'active'
                    ? 'Gyroscope and accelerometer active'
                    : motionState === 'denied'
                    ? 'Motion sensor permission denied'
                    : motionState === 'unsupported'
                    ? 'Motion sensors unavailable on this browser'
                    : 'Waiting for motion sensor'}
                </span>
                <button
                  type="button"
                  onClick={onRecenterMotion}
                  className="min-h-[36px] rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Recenter
                </button>
              </div>
            )}
          </section>

          {/* Sensitivity Controls */}
          <section className="space-y-4 border-t border-slate-800 pt-5">
            <h3 className="text-xs font-medium text-slate-400">Tracking & Scroll</h3>

            <label className="block space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">Touch Gesture Speed</span>
                <span className="font-mono-num text-slate-400">{preferences.touchSensitivity.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.6"
                max="3.5"
                step="0.1"
                value={preferences.touchSensitivity}
                onChange={(e) => onPreferencesChange({ touchSensitivity: Number(e.target.value) })}
                className="w-full accent-[#C78E65]"
              />
            </label>

            <label className="block space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">Phone Movement Speed</span>
                <span className="font-mono-num text-slate-400">{preferences.motionSensitivity.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.5"
                step="0.1"
                value={preferences.motionSensitivity}
                onChange={(e) => onPreferencesChange({ motionSensitivity: Number(e.target.value) })}
                className="w-full accent-[#C78E65]"
              />
            </label>

            <label className="block space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">Head Scroll Speed</span>
                <span className="font-mono-num text-slate-400">{preferences.scrollSensitivity.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.1"
                value={preferences.scrollSensitivity}
                onChange={(e) => onPreferencesChange({ scrollSensitivity: Number(e.target.value) })}
                className="w-full accent-[#C78E65]"
              />
            </label>

            <div className="flex items-center justify-between pt-1">
              <span className="text-sm text-slate-300">Natural Scroll Direction</span>
              <button
                type="button"
                role="switch"
                aria-checked={preferences.naturalScroll}
                onClick={() => onPreferencesChange({ naturalScroll: !preferences.naturalScroll })}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                  preferences.naturalScroll ? 'bg-[#C78E65]' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    preferences.naturalScroll ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <button
              type="button"
              onClick={onReplayGuide}
              className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#0E1524] px-4 text-xs font-medium text-slate-200 hover:border-[#C78E65]/70 hover:text-white transition-colors whitespace-nowrap"
            >
              Show Gesture Guide
            </button>
          </section>

          {/* Optional Advanced Bridge (collapsed by default) */}
          <details className="group border-t border-slate-800 pt-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-slate-400 hover:text-slate-200">
              <span>Optional: Control OS cursor outside browser</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 shrink-0" />
            </summary>
            <div className="mt-3 space-y-2.5">
              {lanAddresses.length > 0 && (
                <p className="text-xs text-slate-400">
                  Local IP: <span className="font-mono-num text-slate-300">{lanAddresses[0]}</span>
                </p>
              )}
              <a
                href={`/api/desktop-bridge/hotspot?room=${encodeURIComponent(preferences.roomId)}`}
                download="eli-kunju-hotspot.py"
                className="inline-flex w-full min-h-[40px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-[#0E1524] px-3 text-xs font-medium text-slate-200 hover:border-[#C78E65]/70 whitespace-nowrap transition-colors"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Mobile Hotspot Bridge (.py)</span>
              </a>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`/api/desktop-bridge/python?room=${encodeURIComponent(preferences.roomId)}`}
                  download="eli-kunju-bridge.py"
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-[#0E1524] px-3 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap transition-colors"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Python</span>
                </a>
                <a
                  href={`/api/desktop-bridge/node?room=${encodeURIComponent(preferences.roomId)}`}
                  download="eli-kunju-bridge.mjs"
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-[#0E1524] px-3 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap transition-colors"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Node.js</span>
                </a>
              </div>
            </div>
          </details>

          {/* PWA Install Button */}
          <div className="pt-1">
            <PWAInstallButton />
          </div>
        </div>
      </div>
    </div>
  );
};
