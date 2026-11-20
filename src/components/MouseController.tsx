import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseButton, MouseCommand, MousePreferences } from '../types/mouse';

type HitZone = 'head' | 'left' | 'right' | 'canvas';

interface RippleFeedback {
  id: number;
  x: number;
  y: number;
  kind: 'left' | 'right';
}

interface MouseControllerProps {
  preferences: MousePreferences;
  onCommand: (cmd: MouseCommand) => void;
  onTouchGlideChange?: (gliding: boolean) => void;
  onTapImpact?: () => void;
  onFirstInteraction?: () => void;
  showGuide?: boolean;
  onDismissGuide?: () => void;
}

// Exact geometry measured from public/assets/aistudio/image_2d5faa2c.png (395 x 547)
const IMG_W = 395;
const IMG_H = 547;
const CENTER_X = 176; // Exact dashed divider X coordinate in the source artwork
const HEAD_CX = 176;
const HEAD_CY = 196;
const HEAD_RX = 122;
const HEAD_RY = 94;
const BODY_CX = 176;
const BODY_CY = 384;
const BODY_RX = 158;
const BODY_RY = 104;
const NECK_Y = 286;

const CANVAS_MOVE_DEADZONE = 2.5;
const BODY_MOVE_DEADZONE = 8;
const HEAD_SCROLL_DEADZONE = 2.5;
const TAP_MAX_DIST = 8;
const TAP_MAX_MS = 340;
const DOUBLE_TAP_MS = 300;
const HOLD_DRAG_MS = 420;

export const MouseController: React.FC<MouseControllerProps> = ({
  preferences,
  onCommand,
  onTouchGlideChange,
  onTapImpact,
  onFirstInteraction,
  showGuide = false,
  onDismissGuide,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mouseBoxRef = useRef<HTMLDivElement | null>(null);

  const [imgError, setImgError] = useState(false);
  const [activeZone, setActiveZone] = useState<HitZone | null>(null);
  const [holdingButton, setHoldingButton] = useState<MouseButton | null>(null);
  const [scrollState, setScrollState] = useState<{ active: boolean; offset: number; dir: number }>({
    active: false,
    offset: 0,
    dir: 0,
  });
  const [ripples, setRipples] = useState<RippleFeedback[]>([]);

  const scrollHideTimerRef = useRef<number | null>(null);
  const rippleIdRef = useRef(0);
  const lastTapRef = useRef<{ time: number; button: MouseButton } | null>(null);

  // Track active pointers for single-finger gestures + two-finger scroll/right-click
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    pointerId: number | null;
    zone: HitZone;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    startTime: number;
    moved: boolean;
    draggingButton: MouseButton | null;
    holdTimer: number | null;
    twoFingerStartDist: number;
    twoFingerMoved: boolean;
    twoFingerLastY: number;
    twoFingerStartTime: number;
    smoothDx: number;
    smoothDy: number;
  }>({
    pointerId: null,
    zone: 'canvas',
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startTime: 0,
    moved: false,
    draggingButton: null,
    holdTimer: null,
    twoFingerStartDist: 0,
    twoFingerMoved: false,
    twoFingerLastY: 0,
    twoFingerStartTime: 0,
    smoothDx: 0,
    smoothDy: 0,
  });

  const vibrate = useCallback(
    (pattern: number | number[]) => {
      if (!preferences.hapticsEnabled) return;
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(pattern);
        } catch {
          // Ignore devices without vibration permission
        }
      }
    },
    [preferences.hapticsEnabled]
  );

  const spawnRipple = useCallback((clientX: number, clientY: number, kind: 'left' | 'right') => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const id = ++rippleIdRef.current;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    setRipples((prev) => [...prev.slice(-4), { id, x, y, kind }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((item) => item.id !== id));
    }, 280);
  }, []);

  const flashScrollIndicator = useCallback((deltaY: number) => {
    setScrollState((prev) => ({
      active: true,
      offset: Math.max(-34, Math.min(34, prev.offset + deltaY * 0.45)),
      dir: deltaY === 0 ? prev.dir : deltaY > 0 ? 1 : -1,
    }));
    if (scrollHideTimerRef.current !== null) {
      window.clearTimeout(scrollHideTimerRef.current);
    }
    scrollHideTimerRef.current = window.setTimeout(() => {
      setScrollState({ active: false, offset: 0, dir: 0 });
    }, 260);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollHideTimerRef.current !== null) {
        window.clearTimeout(scrollHideTimerRef.current);
      }
      if (gestureRef.current.holdTimer !== null) {
        window.clearTimeout(gestureRef.current.holdTimer);
      }
    };
  }, []);

  // Determine exact hit zone in image coordinate space (395 x 547)
  const classifyPoint = useCallback((clientX: number, clientY: number): HitZone => {
    const box = mouseBoxRef.current;
    if (!box) return 'canvas';
    const rect = box.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 'canvas';

    const ix = ((clientX - rect.left) / rect.width) * IMG_W;
    const iy = ((clientY - rect.top) / rect.height) * IMG_H;

    // 1. Mouse head (including ears upper region) -> Scroll Bar
    const hdx = (ix - HEAD_CX) / HEAD_RX;
    const hdy = (iy - HEAD_CY) / HEAD_RY;
    const inHeadEllipse = hdx * hdx + hdy * hdy <= 1.06;
    const inEars = iy >= 16 && iy <= 140 && ix >= 40 && ix <= 312;
    if ((inHeadEllipse || inEars) && iy <= NECK_Y + 6) {
      return 'head';
    }

    // 2. Mouse body -> Left Click (x < CENTER_X) or Right Click (x >= CENTER_X)
    const bdx = (ix - BODY_CX) / BODY_RX;
    const bdy = (iy - BODY_CY) / BODY_RY;
    if (bdx * bdx + bdy * bdy <= 1.08 && iy >= NECK_Y - 4) {
      return ix < CENTER_X ? 'left' : 'right';
    }

    return 'canvas';
  }, []);

  const clearHoldTimer = () => {
    if (gestureRef.current.holdTimer !== null) {
      window.clearTimeout(gestureRef.current.holdTimer);
      gestureRef.current.holdTimer = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (showGuide) {
      onDismissGuide?.();
    }
    onFirstInteraction?.();
    onTapImpact?.();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some mobile WebViews throw on touch setPointerCapture; continue cleanly without aborting gesture
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const g = gestureRef.current;

    // Two-finger gesture detected (scroll or two-finger tap right-click)
    if (pointersRef.current.size === 2) {
      clearHoldTimer();
      if (g.draggingButton) {
        onCommand({ type: 'up', button: g.draggingButton });
        g.draggingButton = null;
        setHoldingButton(null);
      }
      const pts = Array.from(pointersRef.current.values());
      const avgY = (pts[0].y + pts[1].y) / 2;
      g.twoFingerLastY = avgY;
      g.twoFingerMoved = false;
      g.twoFingerStartTime = performance.now();
      setActiveZone('head');
      return;
    }

    if (pointersRef.current.size > 2) return;

    const zone = classifyPoint(e.clientX, e.clientY);
    g.pointerId = e.pointerId;
    g.zone = zone;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    g.startTime = performance.now();
    g.moved = false;
    g.draggingButton = null;
    g.smoothDx = 0;
    g.smoothDy = 0;

    setActiveZone(zone);

    // Press-and-hold on Left or Right side enters real mouse-down drag mode
    if (zone === 'left' || zone === 'right') {
      clearHoldTimer();
      const btn: MouseButton = zone;
      g.holdTimer = window.setTimeout(() => {
        if (g.pointerId === e.pointerId && !g.moved) {
          g.draggingButton = btn;
          setHoldingButton(btn);
          onCommand({ type: 'down', button: btn });
          vibrate(18);
        }
      }, HOLD_DRAG_MS);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const g = gestureRef.current;

    // Two-finger smooth scroll anywhere
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const avgY = (pts[0].y + pts[1].y) / 2;
      const dy = avgY - g.twoFingerLastY;
      g.twoFingerLastY = avgY;
      if (Math.abs(dy) > 1.2) {
        g.twoFingerMoved = true;
        onTouchGlideChange?.(true);
        const sign = preferences.naturalScroll ? -1 : 1;
        onCommand({
          type: 'scroll',
          dx: 0,
          dy: dy * sign * preferences.scrollSensitivity * 0.55,
        });
        flashScrollIndicator(dy);
      }
      return;
    }

    if (g.pointerId !== e.pointerId) return;

    const rawDx = e.clientX - g.lastX;
    const rawDy = e.clientY - g.lastY;
    g.lastX = e.clientX;
    g.lastY = e.clientY;

    const totalDist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
    const moveThreshold =
      g.zone === 'head'
        ? HEAD_SCROLL_DEADZONE
        : g.zone === 'canvas'
        ? CANVAS_MOVE_DEADZONE
        : BODY_MOVE_DEADZONE;

    if (totalDist > moveThreshold && !g.moved) {
      g.moved = true;
      clearHoldTimer();
      onTouchGlideChange?.(true);
    }

    if (!g.moved && !g.draggingButton) return;

    // Mouse head acts strictly as an instant, responsive tactile scroll bar
    if (g.zone === 'head') {
      const sign = preferences.naturalScroll ? -1 : 1;
      const scrollDx = rawDx * sign * preferences.scrollSensitivity * 0.55;
      const scrollDy = rawDy * sign * preferences.scrollSensitivity * 0.95;
      if (Math.abs(scrollDx) > 0.08 || Math.abs(scrollDy) > 0.08) {
        onCommand({ type: 'scroll', dx: scrollDx, dy: scrollDy });
        flashScrollIndicator(rawDy);
      }
      return;
    }

    // Precision laptop-trackpad response curve:
    // slow finger glide = steady 1:1 aiming for tiny buttons; fast swipe = crosses full 1920px laptop screen in one stroke
    g.smoothDx = g.smoothDx * 0.24 + rawDx * 0.76;
    g.smoothDy = g.smoothDy * 0.24 + rawDy * 0.76;

    const speed = Math.hypot(g.smoothDx, g.smoothDy);
    const accel =
      speed < 2.5
        ? 0.95
        : speed < 10
        ? 1.05 + (speed - 2.5) * 0.14
        : Math.min(3.8, 2.1 + (speed - 10) * 0.09);

    const dx = g.smoothDx * preferences.touchSensitivity * accel;
    const dy = g.smoothDy * preferences.touchSensitivity * accel;

    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
      onCommand({ type: 'move', dx, dy, source: 'touch' });
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const hadTwoFingers = pointersRef.current.size === 2;
    pointersRef.current.delete(e.pointerId);

    const g = gestureRef.current;

    if (hadTwoFingers && !cancelled && !g.twoFingerMoved && performance.now() - g.twoFingerStartTime < 260) {
      onCommand({ type: 'click', button: 'right' });
      spawnRipple(e.clientX, e.clientY, 'right');
      vibrate([10, 22, 10]);
    }

    if (g.pointerId !== e.pointerId) {
      if (pointersRef.current.size === 0) {
        setActiveZone(null);
        onTouchGlideChange?.(false);
      }
      return;
    }

    clearHoldTimer();

    const totalDist = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
    // Strictly never fire a click if the cursor already started gliding
    const isQuickTap = !cancelled && !g.moved && totalDist <= TAP_MAX_DIST && performance.now() - g.startTime <= TAP_MAX_MS;

    if (g.draggingButton) {
      onCommand({ type: 'up', button: g.draggingButton });
      g.draggingButton = null;
      setHoldingButton(null);
      onTapImpact?.();
    } else if (isQuickTap) {
      if (g.zone === 'left' || g.zone === 'right') {
        const btn: MouseButton = g.zone;
        const now = performance.now();
        const prev = lastTapRef.current;
        if (btn === 'left' && prev && prev.button === 'left' && now - prev.time < DOUBLE_TAP_MS) {
          lastTapRef.current = null;
          onCommand({ type: 'dblclick', button: 'left' });
          vibrate([12, 24, 14]);
        } else {
          lastTapRef.current = { time: now, button: btn };
          onCommand({ type: 'click', button: btn });
          vibrate(btn === 'left' ? 12 : [10, 22, 10]);
        }
        spawnRipple(e.clientX, e.clientY, btn);
        onTapImpact?.();
      }
    }

    g.pointerId = null;
    if (pointersRef.current.size === 0) {
      setActiveZone(null);
      onTouchGlideChange?.(false);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const zone = classifyPoint(e.clientX, e.clientY);
    if (zone === 'head') {
      const factor = preferences.scrollSensitivity * 0.25;
      onCommand({ type: 'scroll', dx: e.deltaX * factor, dy: e.deltaY * factor });
      flashScrollIndicator(e.deltaY > 0 ? 10 : -10);
    }
  };

  return (
    <div
      ref={stageRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishPointer(e, false)}
      onPointerCancel={(e) => finishPointer(e, true)}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="eli kunju interactive controller. Left side of body is left click, right side of body is right click, mouse head is scroll bar, slide anywhere to move cursor."
      className="relative flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-[#101827] touch-surface"
    >
      {/* Centered mouse wrapper shifted +5.4% horizontally so the artwork's mouse center (x=176/395) aligns dead-center in the viewport */}
      <div
        ref={mouseBoxRef}
        className="relative aspect-[395/547] h-[min(86dvh,640px)] max-h-[calc(100dvh-32px)] max-w-[92vw] translate-x-[5.4%] select-none"
      >
        {!imgError ? (
          <img
            src="/assets/aistudio/image_2d5faa2c.png"
            alt="Interactive Mouse"
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="pointer-events-none block h-full w-full object-contain select-none"
          />
        ) : (
          <svg
            viewBox={`0 0 ${IMG_W} ${IMG_H}`}
            className="pointer-events-none block h-full w-full"
            aria-hidden="true"
          >
            <circle cx="96" cy="76" r="52" fill="#B67F59" stroke="#573621" strokeWidth="7" />
            <circle cx="256" cy="76" r="52" fill="#B67F59" stroke="#573621" strokeWidth="7" />
            <ellipse cx={HEAD_CX} cy={HEAD_CY} rx="116" ry="88" fill="#C68E67" stroke="#573621" strokeWidth="7" />
            <ellipse cx="128" cy="184" rx="8" ry="12" fill="#111827" />
            <ellipse cx="224" cy="184" rx="8" ry="12" fill="#111827" />
            <ellipse cx={HEAD_CX} cy="242" rx="15" ry="11" fill="#F29EB2" />
            <ellipse cx={BODY_CX} cy={BODY_CY} rx="154" ry="102" fill="#C68E67" stroke="#573621" strokeWidth="7" />
            <line x1={CENTER_X} y1="286" x2={CENTER_X} y2="484" stroke="#FFFFFF" strokeWidth="2.5" strokeDasharray="7 7" />
            <text x="102" y="388" textAnchor="middle" fill="#FFFFFF" fontSize="18" fontWeight="700">LEFT CLICK</text>
            <text x="252" y="388" textAnchor="middle" fill="#FFFFFF" fontSize="18" fontWeight="700">RIGHT CLICK</text>
          </svg>
        )}

        {/* Exact-aligned invisible interactive regions + fleeting tactile feedback overlay */}
        <svg
          viewBox={`0 0 ${IMG_W} ${IMG_H}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <clipPath id="pm-left-body">
              <rect x="0" y={NECK_Y} width={CENTER_X} height={IMG_H - NECK_Y} />
            </clipPath>
            <clipPath id="pm-right-body">
              <rect x={CENTER_X} y={NECK_Y} width={IMG_W - CENTER_X} height={IMG_H - NECK_Y} />
            </clipPath>
          </defs>

          {/* Subtle Left Click active contour glow */}
          <ellipse
            cx={BODY_CX}
            cy={BODY_CY}
            rx="153"
            ry="100"
            clipPath="url(#pm-left-body)"
            fill="rgba(255, 245, 232, 0.22)"
            stroke="rgba(255, 237, 213, 0.65)"
            strokeWidth="3"
            className="transition-opacity duration-150"
            style={{ opacity: activeZone === 'left' || holdingButton === 'left' ? 1 : 0 }}
          />

          {/* Subtle Right Click active contour glow */}
          <ellipse
            cx={BODY_CX}
            cy={BODY_CY}
            rx="153"
            ry="100"
            clipPath="url(#pm-right-body)"
            fill="rgba(255, 245, 232, 0.22)"
            stroke="rgba(255, 237, 213, 0.65)"
            strokeWidth="3"
            className="transition-opacity duration-150"
            style={{ opacity: activeZone === 'right' || holdingButton === 'right' ? 1 : 0 }}
          />

          {/* Subtle Mouse Head Scroll Bar tactile feedback (visible only while scrolling) */}
          <g
            className="transition-opacity duration-150"
            style={{ opacity: scrollState.active || activeZone === 'head' ? 1 : 0 }}
          >
            <ellipse
              cx={HEAD_CX}
              cy={HEAD_CY}
              rx="116"
              ry="89"
              fill="rgba(255, 248, 240, 0.10)"
              stroke="rgba(255, 237, 213, 0.45)"
              strokeWidth="2.5"
            />
            <rect
              x={HEAD_CX - 5}
              y={HEAD_CY - 48}
              width="10"
              height="96"
              rx="5"
              fill="rgba(16, 24, 39, 0.45)"
            />
            <rect
              x={HEAD_CX - 3}
              y={HEAD_CY - 16 + scrollState.offset}
              width="6"
              height="32"
              rx="3"
              fill="rgba(255, 247, 237, 0.92)"
            />
          </g>

          {/* Momentary first-launch Gesture Guide mapped directly to head scroll + left/right click zones */}
          <g
            className="transition-opacity duration-500 ease-out"
            style={{ opacity: showGuide ? 1 : 0 }}
          >
            {/* Head Scroll Zone Guide */}
            <ellipse
              cx={HEAD_CX}
              cy={HEAD_CY}
              rx="116"
              ry="89"
              fill="rgba(247, 223, 201, 0.08)"
              stroke="rgba(247, 223, 201, 0.7)"
              strokeWidth="2"
              strokeDasharray="6 5"
              className="animate-guide-zone"
            />
            {/* Animated Scroll Bar Indicator over Head */}
            <rect
              x={HEAD_CX - 11}
              y={HEAD_CY - 44}
              width="22"
              height="88"
              rx="11"
              fill="rgba(16, 24, 39, 0.62)"
              stroke="rgba(247, 223, 201, 0.65)"
              strokeWidth="1.5"
            />
            <path
              d={`M ${HEAD_CX - 4} ${HEAD_CY - 31} L ${HEAD_CX} ${HEAD_CY - 36} L ${HEAD_CX + 4} ${HEAD_CY - 31}`}
              fill="none"
              stroke="rgba(247, 223, 201, 0.8)"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={`M ${HEAD_CX - 4} ${HEAD_CY + 31} L ${HEAD_CX} ${HEAD_CY + 36} L ${HEAD_CX + 4} ${HEAD_CY + 31}`}
              fill="none"
              stroke="rgba(247, 223, 201, 0.8)"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x={HEAD_CX - 3.5}
              y={HEAD_CY - 10}
              width="7"
              height="20"
              rx="3.5"
              fill="#F7DFC9"
              className="animate-guide-scroll"
            />
            <text
              x={HEAD_CX}
              y={HEAD_CY - 58}
              textAnchor="middle"
              fill="#F8FAFC"
              fontSize="13"
              fontWeight="600"
              letterSpacing="0.04em"
              style={{ paintOrder: 'stroke', stroke: 'rgba(16,24,39,0.85)', strokeWidth: '4px' }}
            >
              SCROLL
            </text>

            {/* Left Click Hemisphere Guide */}
            <ellipse
              cx={BODY_CX}
              cy={BODY_CY}
              rx="153"
              ry="100"
              clipPath="url(#pm-left-body)"
              fill="rgba(247, 223, 201, 0.12)"
              stroke="rgba(247, 223, 201, 0.72)"
              strokeWidth="2"
              strokeDasharray="6 5"
              className="animate-guide-zone"
            />
            <circle
              cx="102"
              cy="346"
              r="14"
              fill="none"
              stroke="#F7DFC9"
              strokeWidth="2"
              className="animate-guide-tap"
            />

            {/* Right Click Hemisphere Guide */}
            <ellipse
              cx={BODY_CX}
              cy={BODY_CY}
              rx="153"
              ry="100"
              clipPath="url(#pm-right-body)"
              fill="rgba(244, 166, 184, 0.12)"
              stroke="rgba(244, 166, 184, 0.75)"
              strokeWidth="2"
              strokeDasharray="6 5"
              className="animate-guide-zone"
              style={{ animationDelay: '350ms' }}
            />
            <circle
              cx="250"
              cy="346"
              r="14"
              fill="none"
              stroke="#F4A6B8"
              strokeWidth="2"
              className="animate-guide-tap"
              style={{ animationDelay: '350ms' }}
            />
          </g>
        </svg>
      </div>

      {/* Subtle momentary bottom gesture summary (clean unboxed text, fades out automatically) */}
      <div
        aria-hidden={!showGuide}
        className={`pointer-events-none fixed inset-x-4 bottom-6 z-20 flex justify-center transition-opacity duration-500 ease-out ${
          showGuide ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <p className="text-center text-xs font-medium tracking-wide text-slate-300/85">
          Drag head to scroll <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span> Tap sides to click <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span> Slide anywhere to move
        </p>
      </div>

      {/* Fleeting tap ripples */}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          style={{ left: ripple.x, top: ripple.y }}
          className={`pointer-events-none absolute h-14 w-14 rounded-full border-2 animate-mouse-ripple ${
            ripple.kind === 'left'
              ? 'border-[#F7DFC9]/80 bg-[#F7DFC9]/15'
              : 'border-[#F4A6B8]/85 bg-[#F4A6B8]/15'
          }`}
        />
      ))}
    </div>
  );
};
