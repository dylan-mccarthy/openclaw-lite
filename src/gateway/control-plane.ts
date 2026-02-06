import { randomUUID } from 'crypto';
import type http from 'http';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import type { AgentEvent } from '../agent/types.js';

export interface GatewayControlPlaneOptions {
  enabled: boolean;
  wsPath: string;
  authToken: string;
  allowUnauthenticated: boolean;
}

export type GatewayEvent =
  | {
      type: 'presence';
      connectedClients: number;
    }
  | {
      type: 'typing';
      sessionId?: string;
      active: boolean;
    }
  | {
      type: 'usage';
      runId?: string;
      sessionId?: string;
      model?: string;
      durationMs?: number;
      toolCount?: number;
      status?: string;
    }
  | {
      type: 'agent_event';
      event: AgentEvent;
    };

interface GatewayClient {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  connectedAt: number;
  userAgent?: string;
}

type IncomingMessage =
  | { type: 'auth'; token?: string }
  | { type: 'ping' };

type OutgoingMessage =
  | { type: 'hello'; clientId: string; requiresAuth: boolean }
  | { type: 'auth_ok' }
  | { type: 'auth_error'; message: string }
  | { type: 'pong' }
  | { type: 'event'; event: GatewayEvent & { timestamp: string } };

export class GatewayControlPlane {
  private options: GatewayControlPlaneOptions;
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, GatewayClient>();
  private typingSessions = new Set<string>();

  constructor(options: GatewayControlPlaneOptions) {
    this.options = options;
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  getStatus() {
    return {
      enabled: this.options.enabled,
      wsPath: this.options.wsPath,
      connectedClients: this.clients.size,
      authenticatedClients: Array.from(this.clients.values()).filter(client => client.authenticated).length,
    };
  }

  attach(server: http.Server): void {
    if (!this.options.enabled || this.wss) {
      return;
    }

    this.wss = new WebSocketServer({ server, path: this.options.wsPath });
    this.wss.on('connection', (socket, request) => {
      const clientId = randomUUID();
      const requiresAuth = this.requiresAuth();
      const client: GatewayClient = {
        id: clientId,
        socket,
        authenticated: !requiresAuth,
        connectedAt: Date.now(),
        userAgent: request.headers['user-agent'],
      };

      this.clients.set(clientId, client);

      this.sendMessage(socket, {
        type: 'hello',
        clientId,
        requiresAuth,
      });

      if (client.authenticated) {
        this.sendPresenceEvent();
      }

      socket.on('message', (data) => {
        this.handleMessage(clientId, data);
      });

      socket.on('close', () => {
        this.clients.delete(clientId);
        this.sendPresenceEvent();
      });

      socket.on('error', (error) => {
        console.warn('[Gateway] Client socket error:', error);
        this.clients.delete(clientId);
        this.sendPresenceEvent();
      });
    });
  }

  close(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.clients.clear();
    this.typingSessions.clear();
  }

  emitAgentEvent(event: AgentEvent): void {
    this.emitEvent({ type: 'agent_event', event });
  }

  emitUsageEvent(payload: Omit<Extract<GatewayEvent, { type: 'usage' }>, 'type'>): void {
    this.emitEvent({
      type: 'usage',
      ...payload,
    });
  }

  setTyping(sessionId: string | undefined, active: boolean): void {
    if (!sessionId) {
      return;
    }

    if (active) {
      this.typingSessions.add(sessionId);
    } else {
      this.typingSessions.delete(sessionId);
    }

    this.emitEvent({
      type: 'typing',
      sessionId,
      active,
    });
  }

  private emitEvent(event: GatewayEvent): void {
    if (!this.wss) {
      return;
    }

    const payload: OutgoingMessage = {
      type: 'event',
      event: {
        ...event,
        timestamp: new Date().toISOString(),
      },
    };

    for (const client of this.clients.values()) {
      if (!client.authenticated) {
        continue;
      }
      this.sendMessage(client.socket, payload);
    }
  }

  private handleMessage(clientId: string, data: RawData): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    let messageText = '';
    if (typeof data === 'string') {
      messageText = data;
    } else if (Buffer.isBuffer(data)) {
      messageText = data.toString('utf-8');
    } else {
      messageText = String(data);
    }

    let parsed: IncomingMessage | null = null;
    try {
      parsed = JSON.parse(messageText) as IncomingMessage;
    } catch (error) {
      this.sendMessage(client.socket, {
        type: 'auth_error',
        message: 'Invalid JSON payload',
      });
      return;
    }

    if (parsed.type === 'ping') {
      this.sendMessage(client.socket, { type: 'pong' });
      return;
    }

    if (parsed.type === 'auth') {
      this.handleAuth(client, parsed.token);
      return;
    }

    this.sendMessage(client.socket, {
      type: 'auth_error',
      message: 'Unknown message type',
    });
  }

  private handleAuth(client: GatewayClient, token?: string): void {
    if (!this.requiresAuth()) {
      client.authenticated = true;
      this.sendMessage(client.socket, { type: 'auth_ok' });
      this.sendPresenceEvent();
      return;
    }

    if (token && token === this.options.authToken) {
      client.authenticated = true;
      this.sendMessage(client.socket, { type: 'auth_ok' });
      this.sendPresenceEvent();
      return;
    }

    this.sendMessage(client.socket, { type: 'auth_error', message: 'Invalid token' });
    try {
      client.socket.close(1008, 'Authentication required');
    } catch (error) {
      // Ignore close errors
    }
  }

  private sendPresenceEvent(): void {
    this.emitEvent({
      type: 'presence',
      connectedClients: Array.from(this.clients.values()).filter(client => client.authenticated).length,
    });
  }

  private requiresAuth(): boolean {
    if (this.options.allowUnauthenticated) {
      return false;
    }

    return this.options.authToken.trim().length > 0;
  }

  private sendMessage(socket: WebSocket, message: OutgoingMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      console.warn('[Gateway] Failed to send message:', error);
    }
  }
}
