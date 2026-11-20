import { useCallback, useEffect, useRef, useState } from 'react';

export type MotionPermissionState = 'idle' | 'active' | 'denied' | 'unsupported';
export type MotionPosture = 'desk' | 'air';

interface UsePhoneMotionOptions {
  enabled: boolean;
  /** True ONLY while the user is actively gliding/scrolling with their finger on the touchscreen */
  touchGliding?: boolean;
  /** Monotonic timestamp (ms) until which brief tap-recoil suppression is active */
  tapSettleUntil?: number;
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

// Precision curve for gyroscope air-mouse: rock-steady for tiny tremors, smooth & fast for wrist turns
function precisionCurve(rateDegPerSec: number, deadzone: number): number {
  const abs = Math.abs(rateDegPerSec);
  if (abs <= deadzone) return 0;
  const effective = abs - deadzone;
  return Math.sign(rateDegPerSec) * Math.pow(effective, 1.12);
}

interface AxisZuptState {
  v: number;
  dir: number; // -1, 0, or 1
  lockoutUntil: number;
  stoppedAt: number;
}

// Zero-Velocity Update (ZUPT) linear mouse integrator:
// Lets you slide your phone flat on a desk/table like a normal physical mouse with ZERO deceleration bounce-back.
export function stepZuptAxis(
  state: AxisZuptState,
  accel: number,
  dt: number,
  now: number,
  noiseFloor = 0.26
): number {
  const absA = Math.abs(accel);

  if (state.dir === 0) {
    // Stationary: ignore tiny sensor noise and residual braking tails right after stopping
    if (absA <= noiseFloor) {
      state.v = 0;
      return 0;
    }
    if (now < state.lockoutUntil) {
      // Allow an immediate strong intentional reversal, swallow gentle braking overshoot
      if (absA < 2.6 || now - state.stoppedAt < 65) {
        state.v = 0;
        return 0;
      }
    }
    state.dir = Math.sign(accel);
    const effectiveA = Math.sign(accel) * (absA - noiseFloor * 0.65);
    state.v = effectiveA * dt;
  } else {
    const sameDir = Math.sign(accel) === state.dir;
    if (absA <= noiseFloor) {
      // Natural friction when sliding force stops
      state.v *= Math.pow(0.03, dt);
    } else if (sameDir) {
      // Continuing push in active direction
      const effectiveA = Math.sign(accel) * (absA - noiseFloor * 0.5);
      state.v += effectiveA * dt;
    } else {
      // Opposite acceleration = hand braking/stopping. Brake firmly and snap to 0 without reversing!
      state.v += accel * dt * 1.65;
    }

    // Clamp max realistic desk-slide speed (~1.4 m/s)
    state.v = Math.max(-1.4, Math.min(1.4, state.v));

    // The instant velocity crosses zero or settles near zero, lock cleanly at zero to prevent bounce-back
    if (state.v * state.dir <= 0.014) {
      state.v = 0;
      state.dir = 0;
      state.stoppedAt = now;
      state.lockoutUntil = now + 150;
      return 0;
    }
  }

  return state.v * dt;
}

export function usePhoneMotion({
  enabled,
  touchGliding = false,
  tapSettleUntil = 0,
  sensitivity,
  onMove,
}: UsePhoneMotionOptions) {
  const [motionState, setMotionState] = useState<MotionPermissionState>('idle');
  const [receivingSensorData, setReceivingSensorData] = useState(false);
  const [posture, setPosture] = useState<MotionPosture>('air');

  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const sensitivityRef = useRef(sensitivity);
  sensitivityRef.current = sensitivity;

  const touchGlidingRef = useRef(touchGliding);
  const glideGraceUntilRef = useRef(0);

  const tapSettleUntilRef = useRef(tapSettleUntil);
  tapSettleUntilRef.current = tapSettleUntil;

  useEffect(() => {
    if (touchGliding) {
      touchGlidingRef.current = true;
    } else {
      if (touchGlidingRef.current) {
        glideGraceUntilRef.current = performance.now() + 140;
      }
      touchGlidingRef.current = false;
    }
  }, [touchGliding]);

  const trackerRef = useRef({
    lastTs: 0,
    emaDx: 0,
    emaDy: 0,
    gravityInit: false,
    gx: 0,
    gy: 0,
    gz: 9.81,
    zuptX: { v: 0, dir: 0, lockoutUntil: 0, stoppedAt: 0 } as AxisZuptState,
    zuptY: { v: 0, dir: 0, lockoutUntil: 0, stoppedAt: 0 } as AxisZuptState,
    lastPosture: 'air' as MotionPosture,
  });

  const lastOrientationRef = useRef<{ alpha: number; beta: number; gamma: number } | null>(null);
  const hasDeviceMotionSignalRef = useRef(false);

  const recenter = useCallback(() => {
    const t = trackerRef.current;
    t.lastTs = 0;
    t.emaDx = 0;
    t.emaDy = 0;
    t.zuptX = { v: 0, dir: 0, lockoutUntil: 0, stoppedAt: 0 };
    t.zuptY = { v: 0, dir: 0, lockoutUntil: 0, stoppedAt: 0 };
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

    hasDeviceMotionSignalRef.current = false;
    setMotionState('active');

    let markedReceiving = false;
    const markSensorAlive = () => {
      if (!markedReceiving) {
        markedReceiving = true;
        setReceivingSensorData(true);
      }
    };

    const isSuppressedNow = (now: number) =>
      touchGlidingRef.current || now < glideGraceUntilRef.current || now < tapSettleUntilRef.current;

    const handleDeviceMotion = (e: DeviceMotionEvent) => {
      const now = performance.now();
      const t = trackerRef.current;
      const dt = t.lastTs > 0 ? Math.min(Math.max((now - t.lastTs) / 1000, 0.004), 0.05) : 0.016;
      t.lastTs = now;

      // 1. Update gravity estimate from accelerationIncludingGravity (works on 100% of phones)
      const accIncl = e.accelerationIncludingGravity;
      const hasAccIncl =
        accIncl && (accIncl.x !== null || accIncl.y !== null || accIncl.z !== null);

      let fallbackLinX = 0;
      let fallbackLinY = 0;
      if (hasAccIncl) {
        const ix = accIncl.x ?? 0;
        const iy = accIncl.y ?? 0;
        const iz = accIncl.z ?? 0;
        if (!t.gravityInit) {
          t.gx = ix;
          t.gy = iy;
          t.gz = iz;
          t.gravityInit = true;
        } else {
          // Smooth low-pass gravity filter
          t.gx = t.gx * 0.86 + ix * 0.14;
          t.gy = t.gy * 0.86 + iy * 0.14;
          t.gz = t.gz * 0.86 + iz * 0.14;
        }
        fallbackLinX = ix - t.gx;
        fallbackLinY = iy - t.gy;
      }

      // Detect whether phone is lying flat on a desk/mousepad vs held upright/tilted in hand
      const isFlatOnDesk = t.gravityInit && Math.abs(t.gz) > 7.4 && Math.hypot(t.gx, t.gy) < 6.0;
      const nextPosture: MotionPosture = isFlatOnDesk ? 'desk' : 'air';
      if (nextPosture !== t.lastPosture) {
        t.lastPosture = nextPosture;
        setPosture(nextPosture);
      }

      // While user is actively gliding finger on touchscreen or during a brief tap impact, hold steady
      if (isSuppressedNow(now)) {
        t.emaDx = 0;
        t.emaDy = 0;
        t.zuptX.v = 0;
        t.zuptX.dir = 0;
        t.zuptY.v = 0;
        t.zuptY.dir = 0;
        return;
      }

      // 2. Extract linear acceleration (prefer OS-fused e.acceleration, fall back to gravity-subtracted)
      const accLin = e.acceleration;
      const hasNativeLin =
        accLin && (accLin.x !== null || accLin.y !== null || accLin.z !== null);
      const linX = hasNativeLin ? accLin.x ?? 0 : hasAccIncl ? fallbackLinX : 0;
      const linY = hasNativeLin ? accLin.y ?? 0 : hasAccIncl ? fallbackLinY : 0;

      // Step ZUPT linear desk/hand mouse displacement (meters)
      const dispX = stepZuptAxis(t.zuptX, linX, dt, now, isFlatOnDesk ? 0.24 : 0.38);
      const dispY = stepZuptAxis(t.zuptY, linY, dt, now, isFlatOnDesk ? 0.24 : 0.38);

      // Speed boost curve so gentle desk slides give precise aiming & brisk slides cross full monitor
      const linSpeed = Math.hypot(t.zuptX.v, t.zuptY.v);
      const deskGain = (1650 + Math.min(1400, linSpeed * 1800)) * sensitivityRef.current;

      const linearDx = dispX * deskGain;
      const linearDy = -dispY * deskGain; // pushing phone forward (+Y) moves cursor UP (-Y)

      // 3. Extract Gyroscope air-mouse rotation
      const rot = e.rotationRate;
      const hasGyro =
        rot && (rot.alpha !== null || rot.beta !== null || rot.gamma !== null);

      let gyroDx = 0;
      let gyroDy = 0;
      if (hasGyro) {
        const rawAlpha = rot.alpha ?? 0;
        const rawBeta = rot.beta ?? 0;
        const rawGamma = rot.gamma ?? 0;

        // When flat on desk, slight yaw twist can gently nudge X if desired, while linear slide dominates.
        // When held in hand, yaw + roll smoothly aim left/right and pitch aims up/down.
        const yawRate = isFlatOnDesk ? -rawAlpha * 0.28 : -rawAlpha * 0.68 + rawGamma * 0.56;
        const pitchRate = isFlatOnDesk ? 0 : rawBeta;

        const curvedYaw = precisionCurve(yawRate, isFlatOnDesk ? 4.5 : 2.2);
        const curvedPitch = precisionCurve(pitchRate, 2.2);

        gyroDx = curvedYaw * dt * 12.0 * sensitivityRef.current;
        gyroDy = -curvedPitch * dt * 12.0 * sensitivityRef.current;
      }

      if (hasNativeLin || hasAccIncl || hasGyro) {
        hasDeviceMotionSignalRef.current = true;
        markSensorAlive();
      }

      // 4. Smart sensor fusion based on posture:
      // - Flat on Desk: Linear mouse sliding (1.0x) + light yaw assist
      // - Held in Hand: Gyroscope air-mouse (1.0x) + linear hand-shift assist (0.55x)
      const rawDx = isFlatOnDesk ? linearDx + gyroDx : gyroDx + linearDx * 0.55;
      const rawDy = isFlatOnDesk ? linearDy : gyroDy + linearDy * 0.55;

      const emaAlpha = isFlatOnDesk ? 0.44 : 0.36;
      t.emaDx = t.emaDx * (1 - emaAlpha) + rawDx * emaAlpha;
      t.emaDy = t.emaDy * (1 - emaAlpha) + rawDy * emaAlpha;

      // Snap cleanly to zero when physical motion stops so cursor never creeps
      if (Math.abs(rawDx) < 0.05 && Math.abs(t.emaDx) < 0.32) t.emaDx = 0;
      if (Math.abs(rawDy) < 0.05 && Math.abs(t.emaDy) < 0.32) t.emaDy = 0;

      const dx = Math.max(-44, Math.min(44, t.emaDx));
      const dy = Math.max(-44, Math.min(44, t.emaDy));

      if (Math.abs(dx) > 0.18 || Math.abs(dy) > 0.18) {
        onMoveRef.current(dx, dy);
      }
    };

    // Fallback to smoothed DeviceOrientation ONLY if devicemotion produces no sensor signals at all
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (hasDeviceMotionSignalRef.current) return;
      if (e.alpha === null && e.beta === null && e.gamma === null) return;

      const now = performance.now();
      const alpha = e.alpha ?? 0;
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;

      const prev = lastOrientationRef.current;
      lastOrientationRef.current = { alpha, beta, gamma };
      if (!prev || isSuppressedNow(now)) return;

      markSensorAlive();

      let dAlpha = alpha - prev.alpha;
      if (dAlpha > 180) dAlpha -= 360;
      if (dAlpha < -180) dAlpha += 360;

      const dBeta = beta - prev.beta;
      const dGamma = gamma - prev.gamma;

      if (Math.abs(dAlpha) > 28 || Math.abs(dBeta) > 28 || Math.abs(dGamma) > 28) return;

      const mixX = -dAlpha * 0.65 + dGamma * 0.7;
      const cleanX = Math.abs(mixX) > 0.12 ? mixX : 0;
      const cleanY = Math.abs(dBeta) > 0.12 ? -dBeta : 0;

      const dx = Math.max(-40, Math.min(40, cleanX * 8.5 * sensitivityRef.current));
      const dy = Math.max(-40, Math.min(40, cleanY * 8.5 * sensitivityRef.current));

      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
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
    posture,
    requestMotionPermission,
    recenter,
  };
}
