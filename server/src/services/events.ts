/**
 * Server-Sent Events hub. Clients subscribe to /api/events and receive a small
 * message whenever operational data changes, so the UI can refetch just the
 * affected slice instead of reloading the page.
 */
import type { Response } from 'express';

export type AppEventType =
  | 'disruption:created'
  | 'disruption:updated'
  | 'live-update:added'
  | 'live-update:edited'
  | 'sync:status';

export interface AppEvent {
  type: AppEventType;
  payload?: Record<string, unknown>;
  at: string;
}

const clients = new Set<Response>();

export function addClient(res: Response): void {
  clients.add(res);
}

export function removeClient(res: Response): void {
  clients.delete(res);
}

export function clientCount(): number {
  return clients.size;
}

export function broadcast(type: AppEventType, payload: Record<string, unknown> = {}): void {
  const event: AppEvent = { type, payload, at: new Date().toISOString() };
  const frame = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.write(frame);
    } catch {
      clients.delete(client);
    }
  }
}

/** Comment frame that keeps proxies from closing idle SSE connections. */
export function heartbeat(): void {
  for (const client of clients) {
    try {
      client.write(': ping\n\n');
    } catch {
      clients.delete(client);
    }
  }
}
