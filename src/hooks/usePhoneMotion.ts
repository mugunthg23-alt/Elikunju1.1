import { useCallback, useEffect, useRef, useState } from 'react';

export type MotionPermissionState = 'idle' | 'active' | 'denied' | 'unsupported';

interface UsePhoneMotionOptions {
  enabled: boolean;
  sensitivity: number;
  onMove: (dx: number, dy: number) => void;
}

export function requiresExplicitMotionPermission(): boolean {
  if (typeof window === 'undefined') return false;
  const DME = window.DeviceMotionEvent as unknown as {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };
  return Boolean(DME && typeof DME.requestPermission === 'function');
}

export function usePhoneMotion({ enabled, sensitivity, onMove }: UsePhoneMotionOptions) {
  const [motionState, setMotionState] = useState<MotionPermissionState>('idle');
  const [receivingSensorData, setReceivingSensorData] = useState(false);

  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = sensitivity;

  // Low-pass gravity estimator + damped linear velocity state for smooth physical phone movement
  const smoothRef = useRef({
    vx: 0,
    vy: 0,
    lastTs: 0,
    biasAx: 0,
    biasAy: 0,
    gravX: 0,
    gravY: 0,
    gravInit: false,
  });
  const lastOrientationRef = useRef<{ alpha: number; beta: number; gamma: number } | null>(null);
  const hasNonZeroGyroRef = useRef(false);

  const recenter = useCallback(() => {
    smoothRef.current = {
      vx: 0,
      vy: 0,
      lastTs: 0,
      biasAx: 0,
      biasAy: 0,
      gravX: 0,
      gravY: 0,
      gravInit: false,
    };
    lastOrientationRef.current = null;
  }, []);

  const requestMotionPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;

    const hasMotion = 'DeviceMotionEvent' in window || 'DeviceOrientationEvent' in window;
    if (!hasMotion) {
      setMotionState('unsupported');
      return false;
    }

    try {
      const DME = window.DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (DME && typeof DME.requestPermission === 'function') {
        const res = await DME.requestPermission();
        if (res !== 'granted') {
          setMotionState('denied');
          return false;
        }
      }

      const DOE = window.DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (DOE && typeof DOE.requestPermission === 'function') {
        await DOE.requestPermission().catch(() => 'denied');
      }

      recenter();
      setMotionState('active');
      return true;
    } catch {
      setMotionState('denied');
      return false;
    }
  }, [recenter]);

  useEffect(() => {
    if (!enabled) {
      recenter();
      setReceivingSensorData(false);
      setMotionState((prev) => (prev === 'active' ? 'idle' : prev));
      return;
    }

    if (
      typeof window === 'undefined' ||
      (!('DeviceMotionEvent' in window) && !('DeviceOrientationEvent' in window))
    ) {
      setMotionState('unsupported');
      return;
    }

    hasNonZeroGyroRef.current = false;
    setMotionState('active');

    let markedReceiving = false;
    const markSensorAlive = () => {
      if (!markedReceiving) {
        markedReceiving = true;
        setReceivingSensorData(true);
      }
    };

    const handleDeviceMotion = (e: DeviceMotionEvent) => {
      const now = performance.now();
      const s = smoothRef.current;
      const dt = s.lastTs > 0 ? Math.min((now - s.lastTs) / 1000, 0.06) : 0.016;
      s.lastTs = now;

      const rot = e.rotationRate;
      const acc = e.acceleration;
      const accG = e.accelerationIncludingGravity;

      let dx = 0;
      let dy = 0;

      // 1) Gyroscope air-mouse / wrist rotation (only disable orientation fallback when gyro actually drives cursor)
      if (rot && (rot.alpha !== null || rot.beta !== null || rot.gamma !== null)) {
        const rawAlpha = rot.alpha ?? 0;
        const rawBeta = rot.beta ?? 0;
        const rawGamma = rot.gamma ?? 0;

        // Combine gamma (roll/wrist tilt) and alpha (yaw pan) so both flat-table turning and air-pointing work naturally
        const yaw = rawGamma * 0.7 + -rawAlpha * 0.65;
        const pitch = rawBeta;

        const deadzoneDeg = 0.65;
        const cleanYaw = Math.abs(yaw) > deadzoneDeg ? yaw : 0;
        const cleanPitch = Math.abs(pitch) > deadzoneDeg ? pitch : 0;

        if (cleanYaw !== 0 || cleanPitch !== 0) {
          hasNonZeroGyroRef.current = true;
          markSensorAlive();
          dx += cleanYaw * dt * 18 * sensitivityRef.current;
          dy += -cleanPitch * dt * 18 * sensitivityRef.current;
        }
      }

      // 2) Linear acceleration (prefer hardware e.acceleration, fall back to high-pass filtered e.accelerationIncludingGravity)
      let rawAx: number | null = null;
      let rawAy: number | null = null;

      if (acc && acc.x !== null && acc.y !== null && (Math.abs(acc.x) > 0.001 || Math.abs(acc.y) > 0.001)) {
        rawAx = acc.x;
        rawAy = acc.y;
      } else if (accG && accG.x !== null && accG.y !== null) {
        if (!s.gravInit) {
          s.gravX = accG.x;
          s.gravY = accG.y;
          s.gravInit = true;
        } else {
          // Low-pass filter isolates gravity; subtracting gives clean linear hand movement
          s.gravX = s.gravX * 0.88 + accG.x * 0.12;
          s.gravY = s.gravY * 0.88 + accG.y * 0.12;
          rawAx = accG.x - s.gravX;
          rawAy = accG.y - s.gravY;
        }
      }

      if (rawAx !== null && rawAy !== null) {
        markSensorAlive();
        if (Math.abs(rawAx) < 0.2) s.biasAx = s.biasAx * 0.92 + rawAx * 0.08;
        if (Math.abs(rawAy) < 0.2) s.biasAy = s.biasAy * 0.92 + rawAy * 0.08;

        const ax = rawAx - s.biasAx;
        const ay = rawAy - s.biasAy;

        const accDeadzone = 0.16;
        const fx = Math.abs(ax) > accDeadzone ? ax : 0;
        const fy = Math.abs(ay) > accDeadzone ? ay : 0;

        // Damped velocity integration prevents runaway cursor drift while remaining responsive on flat surfaces
        s.vx = s.vx * 0.72 + fx * dt * 230 * sensitivityRef.current;
        s.vy = s.vy * 0.72 + -fy * dt * 230 * sensitivityRef.current;

        if (Math.abs(s.vx) < 0.15) s.vx = 0;
        if (Math.abs(s.vy) < 0.15) s.vy = 0;

        dx += s.vx * dt * 32;
        dy += s.vy * dt * 32;
      }

      if (Math.abs(dx) > 0.18 || Math.abs(dy) > 0.18) {
        onMoveRef.current(dx, dy);
      }
    };

    // Orientation fallback stays active whenever hardware gyroscope isn't emitting non-zero rotationRate
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (hasNonZeroGyroRef.current) return;
      if (e.alpha === null && e.beta === null && e.gamma === null) return;

      markSensorAlive();
      const alpha = e.alpha ?? 0;
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;

      const prev = lastOrientationRef.current;
      lastOrientationRef.current = { alpha, beta, gamma };
      if (!prev) return;

      let dAlpha = alpha - prev.alpha;
      if (dAlpha > 180) dAlpha -= 360;
      if (dAlpha < -180) dAlpha += 360;

      const dBeta = beta - prev.beta;
      const dGamma = gamma - prev.gamma;

      // Ignore wild compass jumps (>35 deg in one tick)
      if (Math.abs(dAlpha) > 35 || Math.abs(dBeta) > 35 || Math.abs(dGamma) > 35) return;

      const dx = (-dAlpha * 0.65 + dGamma * 0.85) * 8.5 * sensitivityRef.current;
      const dy = -dBeta * 8.5 * sensitivityRef.current;

      if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) {
        onMoveRef.current(dx, dy);
      }
    };

    window.addEventListener('devicemotion', handleDeviceMotion);
    window.addEventListener('deviceorientation', handleOrientation);

    return () => {
      window.removeEventListener('devicemotion', handleDeviceMotion);
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, [enabled, recenter]);

  return {
    motionState,
    receivingSensorData,
    requestMotionPermission,
    recenter,
  };
}
