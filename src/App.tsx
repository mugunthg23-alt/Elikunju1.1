import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, Wifi } from 'lucide-react';
import { MouseController } from './components/MouseController';
import { ConnectionDrawer } from './components/ConnectionDrawer';
import { DesktopReceiver } from './components/DesktopReceiver';
import { QRScannerModal, type ScannedQRTarget } from './components/QRScannerModal';
import { useMouseSocket } from './hooks/useMouseSocket';
import { requiresExplicitMotionPermission, usePhoneMotion } from './hooks/usePhoneMotion';
import { useOnlineStatus } from './hooks/usePWAInstall';
import type { ClientRole, MouseCommand, MousePreferences } from './types/mouse';

const STORAGE_KEY = 'pocketmouse_prefs_v2';
const GUIDE_SEEN_KEY = 'pocketmouse_gesture_guide_seen_v1';
const GUIDE_DURATION_MS = 4000;

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function loadInitialPreferences(): MousePreferences {
  const params = new URLSearchParams(window.location.search);
  const urlRoom = params.get('room')?.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
  const autoMotion = !requiresExplicitMotionPermission();

  const defaults: MousePreferences = {
    roomId: urlRoom || generateRoomCode(),
    relayOrigin: '',
    connectionMode: 'relay',
    lanUrl: '',
    touchSensitivity: 1.8,
    motionSensitivity: 1.5,
    scrollSensitivity: 1.3,
    naturalScroll: false,
    motionEnabled: autoMotion,
    hapticsEnabled: true,
  };

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<MousePreferences>;
    return {
      ...defaults,
      ...parsed,
      connectionMode: urlRoom ? 'relay' : parsed.connectionMode || 'relay',
      relayOrigin: urlRoom ? '' : parsed.relayOrigin || '',
      roomId: urlRoom || parsed.roomId || defaults.roomId,
    };
  } catch {
    return defaults;
  }
}

function loadInitialRole(): ClientRole {
  const params = new URLSearchParams(window.location.search);
  const explicitMode = params.get('mode');
  if (explicitMode === 'desktop') return 'desktop';
  if (explicitMode === 'mobile' || params.get('room')) return 'mobile';

  // On laptops/desktops with a mouse pointer and wide screen, open directly to Laptop QR View so mobile can scan immediately.
  // On mobile phones/tablets, always open directly to the pure Mouse controller screen.
  const isDesktopScreen =
    typeof window !== 'undefined' &&
    window.innerWidth >= 1024 &&
    window.matchMedia?.('(pointer: fine)').matches;
  return isDesktopScreen ? 'desktop' : 'mobile';
}

export default function App() {
  const [role, setRole] = useState<ClientRole>(loadInitialRole);
  const [preferences, setPreferences] = useState<MousePreferences>(loadInitialPreferences);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [touchGliding, setTouchGliding] = useState(false);
  const [tapSettleUntil, setTapSettleUntil] = useState(0);
  const iosAutoUnlockAttemptedRef = useRef(false);
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);
  const [pairNotice, setPairNotice] = useState<{ text: string; tone: 'pending' | 'ok' | 'warn' } | null>(null);
  const pairNoticeTimerRef = useRef<number | null>(null);
  const recentlyScannedRoomRef = useRef<string | null>(
    (() => {
      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get('room')?.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
      return urlRoom || null;
    })()
  );

  const [showGuide, setShowGuide] = useState<boolean>(() => {
    try {
      return !window.localStorage.getItem(GUIDE_SEEN_KEY);
    } catch {
      return true;
    }
  });
  const guideTimerRef = useRef<number | null>(null);

  const dismissGuide = useCallback(() => {
    if (guideTimerRef.current !== null) {
      window.clearTimeout(guideTimerRef.current);
      guideTimerRef.current = null;
    }
    setShowGuide(false);
    try {
      window.localStorage.setItem(GUIDE_SEEN_KEY, '1');
    } catch {
      // Ignore private browsing restriction
    }
  }, []);

  const triggerGuideMomentarily = useCallback(() => {
    if (guideTimerRef.current !== null) {
      window.clearTimeout(guideTimerRef.current);
    }
    setShowGuide(true);
    guideTimerRef.current = window.setTimeout(() => {
      dismissGuide();
    }, GUIDE_DURATION_MS);
  }, [dismissGuide]);

  const showTransientNotice = useCallback((text: string, tone: 'pending' | 'ok' | 'warn', durationMs: number) => {
    if (pairNoticeTimerRef.current !== null) {
      window.clearTimeout(pairNoticeTimerRef.current);
      pairNoticeTimerRef.current = null;
    }
    setPairNotice({ text, tone });
    if (durationMs > 0) {
      pairNoticeTimerRef.current = window.setTimeout(() => {
        setPairNotice(null);
        pairNoticeTimerRef.current = null;
      }, durationMs);
    }
  }, []);

  useEffect(() => {
    if (role !== 'mobile' || !showGuide) return;
    guideTimerRef.current = window.setTimeout(() => {
      dismissGuide();
    }, GUIDE_DURATION_MS);
    return () => {
      if (guideTimerRef.current !== null) {
        window.clearTimeout(guideTimerRef.current);
        guideTimerRef.current = null;
      }
    };
  }, [role, showGuide, dismissGuide]);

  useEffect(() => {
    return () => {
      if (pairNoticeTimerRef.current !== null) {
        window.clearTimeout(pairNoticeTimerRef.current);
      }
    };
  }, []);

  const isOnline = useOnlineStatus();
  const desktopCommandHandlerRef = useRef<((cmd: MouseCommand) => void) | null>(null);

  const registerDesktopCommandHandler = useCallback((handler: (cmd: MouseCommand) => void) => {
    desktopCommandHandlerRef.current = handler;
  }, []);

  const handleIncomingCommand = useCallback((cmd: MouseCommand) => {
    desktopCommandHandlerRef.current?.(cmd);
  }, []);

  const updatePreferences = useCallback((patch: Partial<MousePreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore private browsing storage restriction
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/network-info')
      .then((res) => {
        const ct = res.headers.get('content-type') || '';
        return res.ok && ct.includes('application/json') ? res.json() : null;
      })
      .then((data: { lanAddresses?: string[] } | null) => {
        if (!active || !data?.lanAddresses) return;
        setLanAddresses(data.lanAddresses);
      })
      .catch(() => {
        // Static hosting (e.g. Netlify) has no /api/network-info route — ignore cleanly
      });
    return () => {
      active = false;
    };
  }, []);

  const { status, transport, peerCounts, osBridgeConnected, latencyMs, errorDetail, sendCommand } = useMouseSocket({
    role,
    roomId: preferences.roomId,
    relayOrigin: role === 'mobile' ? preferences.relayOrigin : '',
    connectionMode: preferences.connectionMode,
    lanUrl: preferences.lanUrl,
    onCommand: handleIncomingCommand,
  });

  // Show truthful live pairing confirmation ONLY right after scanning/joining a room, then auto-fade completely
  useEffect(() => {
    if (role !== 'mobile' || !recentlyScannedRoomRef.current) return;
    if (status === 'connected' && peerCounts.desktop > 0) {
      const room = recentlyScannedRoomRef.current;
      recentlyScannedRoomRef.current = null;
      showTransientNotice(`Paired with Laptop · Room ${room}`, 'ok', 2200);
    }
  }, [role, status, peerCounts.desktop, showTransientNotice]);

  const handleMotionMove = useCallback(
    (dx: number, dy: number) => {
      sendCommand({ type: 'move', dx, dy, source: 'motion' });
    },
    [sendCommand]
  );

  const { motionState, requestMotionPermission, recenter } = usePhoneMotion({
    enabled: role === 'mobile' && preferences.motionEnabled,
    touchGliding,
    tapSettleUntil,
    sensitivity: preferences.motionSensitivity,
    onMove: handleMotionMove,
  });

  const handleTapImpact = useCallback(() => {
    setTapSettleUntil(performance.now() + 140);
  }, []);

  const handleFirstInteraction = useCallback(() => {
    // On iOS Safari, automatically unlock physical phone motion on the very first touch gesture
    if (
      !iosAutoUnlockAttemptedRef.current &&
      requiresExplicitMotionPermission() &&
      !preferences.motionEnabled
    ) {
      iosAutoUnlockAttemptedRef.current = true;
      void requestMotionPermission().then((granted) => {
        if (granted) {
          updatePreferences({ motionEnabled: true });
        }
      });
    }
  }, [preferences.motionEnabled, requestMotionPermission, updatePreferences]);

  const handleToggleMotion = useCallback(
    async (next: boolean) => {
      if (!next) {
        updatePreferences({ motionEnabled: false });
        return;
      }
      const granted = await requestMotionPermission();
      if (granted) {
        updatePreferences({ motionEnabled: true });
      }
    },
    [requestMotionPermission, updatePreferences]
  );

  const handleOpenScanner = useCallback(() => {
    if (showGuide) dismissGuide();
    handleFirstInteraction();
    setScannerOpen(true);
  }, [showGuide, dismissGuide, handleFirstInteraction]);

  const handleScannedRoom = useCallback(
    ({ roomId, relayOrigin }: ScannedQRTarget) => {
      recentlyScannedRoomRef.current = roomId;
      updatePreferences({
        roomId,
        relayOrigin,
        connectionMode: 'relay',
        motionEnabled: !requiresExplicitMotionPermission() ? true : preferences.motionEnabled,
      });
      setRole('mobile');
      setScannerOpen(false);
      setDrawerOpen(false);
      showTransientNotice(`Linking to Laptop · Room ${roomId}…`, 'pending', 4200);

      // If laptop peer hasn't responded after 4.2s, inform the user clearly instead of staying silent
      window.setTimeout(() => {
        if (recentlyScannedRoomRef.current === roomId) {
          recentlyScannedRoomRef.current = null;
          showTransientNotice(
            `Keep Laptop QR View open on Room ${roomId}`,
            'warn',
            3800
          );
        }
      }, 4200);
    },
    [updatePreferences, preferences.motionEnabled, showTransientNotice]
  );

  if (role === 'desktop') {
    return (
      <DesktopReceiver
        roomId={preferences.roomId}
        onRefreshRoom={() =>
          updatePreferences({ roomId: generateRoomCode(), relayOrigin: '', connectionMode: 'relay' })
        }
        socketStatus={status}
        transport={transport}
        mobileCount={peerCounts.mobile}
        osBridgeConnected={osBridgeConnected}
        latencyMs={latencyMs}
        lanAddresses={lanAddresses}
        onSwitchToMobile={() => setRole('mobile')}
        registerCommandHandler={registerDesktopCommandHandler}
      />
    );
  }

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden bg-[#101827]">
      <MouseController
        preferences={preferences}
        onCommand={sendCommand}
        onTouchGlideChange={setTouchGliding}
        onTapImpact={handleTapImpact}
        onFirstInteraction={handleFirstInteraction}
        showGuide={showGuide}
        onDismissGuide={dismissGuide}
      />

      {/* Momentary pairing status toast shown ONLY immediately after scanning a laptop QR */}
      {pairNotice && (
        <div
          role="status"
          className={`pointer-events-none fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-xl px-3.5 py-2 text-xs font-medium shadow-lg whitespace-nowrap transition-opacity duration-300 ${
            pairNotice.tone === 'ok'
              ? 'bg-emerald-500/95 text-[#08131A]'
              : pairNotice.tone === 'warn'
              ? 'bg-amber-400/95 text-[#101827]'
              : 'bg-slate-800/95 text-slate-100 border border-slate-700'
          }`}
          style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
        >
          {pairNotice.text}
        </div>
      )}

      {/* Quiet top-right corner actions: 1-tap Scan Laptop QR + Settings/Wi-Fi */}
      <div
        className="fixed right-3 top-3 z-30 flex items-center gap-1"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <button
          type="button"
          onClick={handleOpenScanner}
          aria-label="Scan laptop QR code"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-300/40 transition-opacity duration-150 hover:text-slate-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[#C78E65]"
        >
          <QrCode className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (showGuide) dismissGuide();
            setDrawerOpen(true);
          }}
          aria-label="Open pairing and mouse settings"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-300/40 transition-opacity duration-150 hover:text-slate-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[#C78E65]"
        >
          <Wifi className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      {/* Non-intrusive offline indicator (shown only when browser goes offline) */}
      {!isOnline && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-amber-500/95 px-3.5 py-2 text-xs font-medium text-[#101827] shadow-lg whitespace-nowrap"
        >
          Offline — reconnect Wi-Fi or Hotspot to control laptop
        </div>
      )}

      <ConnectionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onOpenScanner={() => {
          setDrawerOpen(false);
          handleOpenScanner();
        }}
        role={role}
        onRoleChange={(nextRole) => {
          if (nextRole === 'desktop') {
            updatePreferences({ relayOrigin: '' });
          }
          setRole(nextRole);
          setDrawerOpen(false);
        }}
        preferences={preferences}
        onPreferencesChange={updatePreferences}
        socketStatus={status}
        peerCounts={peerCounts}
        latencyMs={latencyMs}
        errorDetail={errorDetail}
        motionState={motionState}
        onToggleMotion={handleToggleMotion}
        onRecenterMotion={recenter}
        onReplayGuide={() => {
          setDrawerOpen(false);
          setRole('mobile');
          triggerGuideMomentarily();
        }}
        lanAddresses={lanAddresses}
      />

      <QRScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScannedRoom={handleScannedRoom}
      />
    </main>
  );
}
