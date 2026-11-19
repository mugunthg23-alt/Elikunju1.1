export type ClientRole = 'mobile' | 'desktop';

export type MouseButton = 'left' | 'right';

export type ConnectionMode = 'relay' | 'lan';

export type MouseCommand =
  | { type: 'move'; dx: number; dy: number; source: 'touch' | 'motion' }
  | { type: 'click'; button: MouseButton }
  | { type: 'dblclick'; button: MouseButton }
  | { type: 'down'; button: MouseButton }
  | { type: 'up'; button: MouseButton }
  | { type: 'scroll'; dx: number; dy: number };

export type ClientToServerMessage =
  | { type: 'join'; roomId: string; role: ClientRole }
  | { type: 'ping'; ts: number }
  | MouseCommand;

export type ServerToClientMessage =
  | {
      type: 'peer:status';
      roomId: string;
      mobileCount: number;
      desktopCount: number;
    }
  | { type: 'pong'; ts: number }
  | MouseCommand;

export interface MousePreferences {
  roomId: string;
  connectionMode: ConnectionMode;
  lanUrl: string;
  touchSensitivity: number;
  motionSensitivity: number;
  scrollSensitivity: number;
  naturalScroll: boolean;
  motionEnabled: boolean;
  hapticsEnabled: boolean;
}
