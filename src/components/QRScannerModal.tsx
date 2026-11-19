import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, Check, X } from 'lucide-react';

interface QRScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScannedRoom: (roomId: string) => void;
}

function extractRoomCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const param = url.searchParams.get('room');
    if (param) {
      const cleaned = param.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
      if (cleaned.length >= 2) return cleaned;
    }
  } catch {
    // Not a URL; check plain code formats
  }

  const prefixMatch = trimmed.match(/^(?:elikunju|room):([a-zA-Z0-9]{2,8})$/i);
  if (prefixMatch) {
    return prefixMatch[1].toUpperCase();
  }

  if (/^[a-zA-Z0-9]{3,8}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  open,
  onClose,
  onScannedRoom,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onScannedRef = useRef(onScannedRoom);
  onScannedRef.current = onScannedRoom;

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');

  useEffect(() => {
    if (!open) {
      setCameraError(null);
      setScannedCode(null);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let lastDecodeTime = 0;

    const stopCamera = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
    };

    const scanFrame = (now: number) => {
      if (cancelled) return;
      rafId = window.requestAnimationFrame(scanFrame);

      // Decode at ~15 fps to stay smooth and battery-friendly
      if (now - lastDecodeTime < 65) return;
      lastDecodeTime = now;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      const targetW = Math.min(video.videoWidth, 640);
      const scale = targetW / video.videoWidth;
      const targetH = Math.round(video.videoHeight * scale);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, targetW, targetH);

      const imageData = ctx.getImageData(0, 0, targetW, targetH);
      const decoded = jsQR(imageData.data, targetW, targetH, {
        inversionAttempts: 'dontInvert',
      });

      if (decoded?.data) {
        const room = extractRoomCode(decoded.data);
        if (room) {
          cancelled = true;
          stopCamera();
          setScannedCode(room);
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try {
              navigator.vibrate(25);
            } catch {
              // Ignore
            }
          }
          window.setTimeout(() => {
            onScannedRef.current(room);
          }, 360);
        }
      }
    };

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera access is not available on this browser. Enter the laptop pairing code below.');
        return;
      }

      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (cancelled) {
          stopCamera();
          return;
        }

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          rafId = window.requestAnimationFrame(scanFrame);
        }
      } catch {
        if (!cancelled) {
          setCameraError('Allow camera permission to scan the QR code shown on your laptop, or enter the code below.');
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open]);

  if (!open) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
    if (cleaned.length >= 2) {
      onScannedRoom(cleaned);
      setManualCode('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0B111E] text-slate-100"
      role="dialog"
      aria-modal="true"
      aria-label="Scan Laptop QR Code"
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-4 border-b border-slate-800/80 px-5 py-4"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="flex items-center gap-2.5">
          <Camera className="h-5 w-5 text-[#C78E65] shrink-0" />
          <h2 className="font-display text-base font-semibold tracking-tight text-slate-100">
            Scan Laptop QR
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Live camera viewfinder */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Viewfinder corner reticle */}
        {!cameraError && !scannedCode && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
            <div className="relative h-60 w-60 max-w-[74vw] max-h-[74vw]">
              <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-2xl border-l-4 border-t-4 border-[#C78E65]" />
              <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-2xl border-r-4 border-t-4 border-[#C78E65]" />
              <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-[#C78E65]" />
              <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-2xl border-b-4 border-r-4 border-[#C78E65]" />
            </div>
            <p className="mt-6 text-center text-xs font-medium text-slate-200 drop-shadow">
              Point your phone at the QR code on your laptop screen
            </p>
          </div>
        )}

        {/* Scanned confirmation overlay */}
        {scannedCode && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#101827]/90 backdrop-blur-xs p-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#C78E65] text-[#101827]">
              <Check className="h-7 w-7" strokeWidth={2.5} />
            </div>
            <p className="mt-4 font-display text-lg font-semibold text-white">
              Laptop Connected
            </p>
            <p className="mt-1 font-mono-num text-sm text-slate-300">
              Room {scannedCode}
            </p>
          </div>
        )}

        {/* Camera unavailable message */}
        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#101827] p-6">
            <p className="max-w-xs text-center text-sm text-slate-300 leading-relaxed">
              {cameraError}
            </p>
          </div>
        )}
      </div>

      {/* Quick manual fallback at bottom */}
      <form
        onSubmit={handleManualSubmit}
        className="border-t border-slate-800 bg-[#151F32] px-5 py-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mx-auto flex max-w-md items-center gap-2.5">
          <label htmlFor="qr-manual-code" className="sr-only">
            Enter laptop code manually
          </label>
          <input
            id="qr-manual-code"
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            maxLength={8}
            placeholder="Or enter 4-digit laptop code"
            className="font-mono-num min-h-[44px] flex-1 rounded-xl border border-slate-700 bg-[#0E1524] px-3.5 text-sm tracking-wider text-slate-100 placeholder:text-slate-500 focus:border-[#C78E65] focus:outline-none"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded-xl bg-[#C78E65] px-4 text-sm font-semibold text-[#101827] hover:bg-[#D59E76] whitespace-nowrap shrink-0 transition-colors"
          >
            Connect
          </button>
        </div>
      </form>
    </div>
  );
};
