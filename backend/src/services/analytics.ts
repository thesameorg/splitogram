import { analyticsEvents } from '../db/schema';
import type { Database } from '../db';

export function trackEvent(
  db: Database,
  userId: number,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  return db
    .insert(analyticsEvents)
    .values({
      userId,
      event,
      properties: properties ? JSON.stringify(properties) : null,
    })
    .then(() => {});
}
