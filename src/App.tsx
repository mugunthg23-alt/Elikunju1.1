import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, Wifi } from 'lucide-react';
import { MouseController } from './components/MouseController';
import { ConnectionDrawer } from './components/ConnectionDrawer';
import { DesktopReceiver } from './components/DesktopReceiver';
import { QRScannerModal } from './components/QRScannerModal';
import { useMouseSocket } from './hooks/useMouseSocket';
import { usePhoneMotion } from './hooks/usePhoneMotion';
import { useOnlineStatus } from './hooks/usePWAInstall';
import type { ClientRole, MouseCommand, MousePreferences } from './types/mouse';

const STORAGE_KEY = 'pocketmouse_prefs_v1';
const GUIDE_SEEN_KEY = 'pocketmouse_gesture_guide_seen_v1';
const GUIDE_DURATION_MS = 4000;

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function loadInitialPreferences(): MousePreferences {
  const params = new URLSearchParams(window.location.search);
  const urlRoom = params.get('room')?.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);

  const defaults: MousePreferences = {
    roomId: urlRoom || generateRoomCode(),
    connectionMode: 'relay',
    lanUrl: '',
    touchSensitivity: 1.6,
    motionSensitivity: 1.5,
    scrollSensitivity: 1.2,
    naturalScroll: false,
    motionEnabled: false,
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
      roomId: urlRoom || parsed.roomId || defaults.roomId,
    };
  } catch {
    return defaults;
  }
}

function loadInitialRole(): ClientRole {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'desktop' ? 'desktop' : 'mobile';
}

export default function App() {
  const [role, setRole] = useState<ClientRole>(loadInitialRole);
  const [preferences, setPreferences] = useState<MousePreferences>(loadInitialPreferences);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);
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
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { lanAddresses?: string[] } | null) => {
        if (!active || !data?.lanAddresses) return;
        setLanAddresses(data.lanAddresses);
      })
      .catch(() => {
        // Ignore offline network-info lookup
      });
    return () => {
      active = false;
    };
  }, []);

  const { status, peerCounts, latencyMs, errorDetail, sendCommand } = useMouseSocket({
    role,
    roomId: preferences.roomId,
    connectionMode: preferences.connectionMode,
    lanUrl: preferences.lanUrl,
    onCommand: handleIncomingCommand,
  });

  const handleMotionMove = useCallback(
    (dx: number, dy: number) => {
      sendCommand({ type: 'move', dx, dy, source: 'motion' });
    },
    [sendCommand]
  );

  const { motionState, requestMotionPermission, recenter } = usePhoneMotion({
    enabled: role === 'mobile' && preferences.motionEnabled,
    sensitivity: preferences.motionSensitivity,
    onMove: handleMotionMove,
  });

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

  const handleScannedRoom = useCallback(
    (roomId: string) => {
      updatePreferences({ roomId, connectionMode: 'relay' });
      setRole('mobile');
      setScannerOpen(false);
      setDrawerOpen(false);
    },
    [updatePreferences]
  );

  if (role === 'desktop') {
    return (
      <DesktopReceiver
        roomId={preferences.roomId}
        onRefreshRoom={() => updatePreferences({ roomId: generateRoomCode(), connectionMode: 'relay' })}
        socketStatus={status}
        mobileCount={peerCounts.mobile}
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
        showGuide={showGuide}
        onDismissGuide={dismissGuide}
      />

      {/* Quiet top-right corner actions: 1-tap Scan Laptop QR + Settings/Wi-Fi */}
      <div
        className="fixed right-3 top-3 z-30 flex items-center gap-1"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <button
          type="button"
          onClick={() => {
            if (showGuide) dismissGuide();
            setScannerOpen(true);
          }}
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
          setScannerOpen(true);
        }}
        role={role}
        onRoleChange={(nextRole) => {
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
