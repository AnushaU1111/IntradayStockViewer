import { dayKey } from "./dayKey.js";

export interface SessionInfo {
  timeZone: string;
  sessionStart: number | null;
  sessionEnd: number | null;
}

/**
 * Today's exchange-local date while the regular session is open, else null.
 * The end is exclusive, so the header disappears at the close (DECISIONS D-12).
 */
export function partialDay(now: Date, session: SessionInfo): string | null {
  const { sessionStart, sessionEnd, timeZone } = session;
  if (sessionStart === null || sessionEnd === null) return null;

  const t = Math.floor(now.getTime() / 1000);
  return t >= sessionStart && t < sessionEnd ? dayKey(t, timeZone) : null;
}
