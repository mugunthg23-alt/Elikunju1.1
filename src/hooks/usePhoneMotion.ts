import { useCallback, useEffect, useRef, useState } from 'react';

export type MotionPermissionState = 'idle' | 'active' | 'denied' | 'unsupported';

interface UsePhoneMotionOptions {
  enabled: boolean;
  sensitivity: number;
  onMove: (dx: number, dy: number) => void;
}

interface DeviceMotionEventiOS extends DeviceMotionEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

interface DeviceOrientationEventiOS extends DeviceOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export function usePhoneMotion({ enabled, sensitivity, onMove }: UsePhoneMotionOptions) {
  const [motionState, setMotionState] = useState<MotionPermissionState>('idle');
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = sensitivity;

  // Low-pass & drift-damping state for smooth physical phone movement
  const smoothRef = useRef({ vx: 0, vy: 0, lastTs: 0, biasAx: 0, biasAy: 0 });
  const lastOrientationRef = useRef<{ alpha: number; beta: number; gamma: number } | null>(null);
  const receivedMotionRef = useRef(false);

  const recenter = useCallback(() => {
    smoothRef.current = { vx: 0, vy: 0, lastTs: 0, biasAx: 0, biasAy: 0 };
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
      setMotionState((prev) => (prev === 'active' ? 'idle' : prev));
      return;
    }

    if (typeof window === 'undefined' || (!('DeviceMotionEvent' in window) && !('DeviceOrientationEvent' in window))) {
      setMotionState('unsupported');
      return;
    }

    receivedMotionRef.current = false;
    setMotionState('active');

    const handleDeviceMotion = (e: DeviceMotionEvent) => {
      const now = performance.now();
      const s = smoothRef.current;
      const dt = s.lastTs > 0 ? Math.min((now - s.lastTs) / 1000, 0.06) : 0.016;
      s.lastTs = now;

      const rot = e.rotationRate;
      const acc = e.acceleration;

      let dx = 0;
      let dy = 0;

      // 1) Gyroscope air-mouse / wrist rotation (lowest latency & zero gravity drift)
      if (rot && (rot.alpha !== null || rot.beta !== null || rot.gamma !== null)) {
        receivedMotionRef.current = true;
        const yaw = rot.gamma ?? rot.alpha ?? 0; // left/right pan
        const pitch = rot.beta ?? 0; // up/down tilt

        const deadzoneDeg = 3.5;
        const cleanYaw = Math.abs(yaw) > deadzoneDeg ? yaw : 0;
        const cleanPitch = Math.abs(pitch) > deadzoneDeg ? pitch : 0;

        dx += cleanYaw * dt * 14 * sensitivityRef.current;
        dy += -cleanPitch * dt * 14 * sensitivityRef.current;
      }

      // 2) Linear acceleration for sliding phone flat like a physical desk mouse
      if (acc && acc.x !== null && acc.y !== null) {
        receivedMotionRef.current = true;
        // Slowly adapt static sensor bias when nearly still
        if (Math.abs(acc.x) < 0.25) s.biasAx = s.biasAx * 0.92 + acc.x * 0.08;
        if (Math.abs(acc.y) < 0.25) s.biasAy = s.biasAy * 0.92 + acc.y * 0.08;

        const ax = acc.x - s.biasAx;
        const ay = acc.y - s.biasAy;

        const accDeadzone = 0.28;
        const fx = Math.abs(ax) > accDeadzone ? ax : 0;
        const fy = Math.abs(ay) > accDeadzone ? ay : 0;

        // Damped velocity integration prevents runaway cursor drift
        s.vx = s.vx * 0.72 + fx * dt * 190 * sensitivityRef.current;
        s.vy = s.vy * 0.72 + -fy * dt * 190 * sensitivityRef.current;

        if (Math.abs(s.vx) < 0.2) s.vx = 0;
        if (Math.abs(s.vy) < 0.2) s.vy = 0;

        dx += s.vx * dt * 28;
        dy += s.vy * dt * 28;
      }

      if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) {
        onMoveRef.current(dx, dy);
      }
    };

    // Fallback to orientation deltas if DeviceMotion provides nulls
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (receivedMotionRef.current) return;
      if (e.alpha === null || e.beta === null || e.gamma === null) return;

      const prev = lastOrientationRef.current;
      lastOrientationRef.current = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
      if (!prev) return;

      let dAlpha = e.alpha - prev.alpha;
      if (dAlpha > 180) dAlpha -= 360;
      if (dAlpha < -180) dAlpha += 360;

      const dBeta = e.beta - prev.beta;
      const dGamma = e.gamma - prev.gamma;

      const dx = (-dAlpha * 0.7 + dGamma * 0.5) * 6 * sensitivityRef.current;
      const dy = -dBeta * 6 * sensitivityRef.current;

      if (Math.abs(dx) > 0.35 || Math.abs(dy) > 0.35) {
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
    requestMotionPermission,
    recenter,
  };
}

export type { DeviceMotionEventiOS, DeviceOrientationEventiOS };
