/**
 * Format raw API notification event strings as UI text.
 */

/**
 * Notification event with display information
 */
export interface NotificationEvent {
  value: string;
  label: string;
  description: string;
}

/**
 * Human-readable labels for notification events
 */
const EVENT_LABELS: Record<string, string> = {
  'subscription.completed': 'Subscription Completed',
  'subscription.failed': 'Subscription Failed',
  'review.pending': 'Review Queue Has Pending Items',
  'artist.added': 'Artist Added to Lidarr',
  'artist.failed': 'Artist Add Failed',
  'enrichment.completed': 'Metadata Enrichment Completed',
};

/**
 * Descriptions for notification events
 */
const EVENT_DESCRIPTIONS: Record<string, string> = {
  'subscription.completed': 'When a subscription run finishes successfully',
  'subscription.failed': 'When a subscription run encounters an error',
  'review.pending': 'When new items are added to the review queue',
  'artist.added': 'When an artist is successfully added to Lidarr',
  'artist.failed': 'When adding an artist to Lidarr fails',
  'enrichment.completed': 'When metadata enrichment completes for artists',
};

/**
 * Format an event name for display
 */
export function formatEventLabel(event: string): string {
  return EVENT_LABELS[event] || event;
}

/**
 * Get the description for an event
 */
export function getEventDescription(event: string): string {
  return EVENT_DESCRIPTIONS[event] || '';
}

/**
 * Transform raw event strings from API into display objects
 */
export function formatEvents(rawEvents: string[]): NotificationEvent[] {
  return rawEvents.map(event => ({
    value: event,
    label: formatEventLabel(event),
    description: getEventDescription(event),
  }));
}
