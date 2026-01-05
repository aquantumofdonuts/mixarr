import 'express-session';

declare module 'express-session' {
  interface SessionData {
    plexPinId?: number;
    passport?: {
      user?: number;
    };
  }
}
