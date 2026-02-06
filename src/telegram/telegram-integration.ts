import type { AgentIntegration } from '../agent/agent-integration.js';
import type { SessionManager } from '../sessions/session-manager.js';
import { TelegramClient, type TelegramUpdate, type TelegramMessage } from './telegram-client.js';
import { TelegramPairingStore } from './pairing-store.js';

export interface TelegramIntegrationOptions {
  botToken: string;
  botUsername?: string;
  mode: 'polling' | 'webhook';
  pollingIntervalMs: number;
  webhookUrl?: string;
  webhookPath: string;
  allowFrom: string[];
  groupAllowFrom: string[];
  requireMentionInGroups: boolean;
  pairingEnabled: boolean;
  pairingCodeLength: number;
  pairingTtlMinutes: number;
  storagePath: string;
  sessionManager: SessionManager;
  agentIntegration: AgentIntegration;
  getSystemPrompt: () => string;
  getModel: () => string;
}

export class TelegramIntegration {
  private client: TelegramClient;
  private pairingStore: TelegramPairingStore;
  private pollingTimer: NodeJS.Timeout | null = null;
  private offset = 0;

  constructor(private options: TelegramIntegrationOptions) {
    this.client = new TelegramClient({ botToken: options.botToken });
    this.pairingStore = new TelegramPairingStore(options.storagePath);
  }

  async start(): Promise<void> {
    if (this.options.mode === 'polling') {
      this.startPolling();
      return;
    }

    if (this.options.mode === 'webhook' && this.options.webhookUrl) {
      const result = await this.client.setWebhook(this.options.webhookUrl);
      if (!result.ok) {
        console.warn('[Telegram] Failed to set webhook:', result.description || 'unknown error');
      }
    }
  }

  stop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  async handleWebhook(update: TelegramUpdate): Promise<void> {
    await this.handleUpdate(update);
  }

  getPairingStore(): TelegramPairingStore {
    return this.pairingStore;
  }

  private startPolling(): void {
    if (this.pollingTimer) {
      return;
    }

    this.pollingTimer = setInterval(() => {
      this.pollUpdates().catch(error => {
        console.warn('[Telegram] Polling error:', error);
      });
    }, this.options.pollingIntervalMs);
  }

  private async pollUpdates(): Promise<void> {
    const response = await this.client.getUpdates({ offset: this.offset });
    if (!response.ok) {
      console.warn('[Telegram] getUpdates failed');
      return;
    }

    for (const update of response.result) {
      this.offset = Math.max(this.offset, update.update_id + 1);
      await this.handleUpdate(update);
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!update.message || !update.message.text) {
      return;
    }

    const message = update.message;
    const chatId = String(message.chat.id);
    const isGroup = message.chat.type === 'group' || message.chat.type === 'supergroup';

    if (isGroup && this.options.requireMentionInGroups && this.options.botUsername) {
      const mentionToken = `@${this.options.botUsername}`;
      if (!message.text.includes(mentionToken)) {
        return;
      }
    }

    const allowed = this.isAllowed(chatId, isGroup);
    if (!allowed) {
      if (this.options.pairingEnabled && !isGroup) {
        const ttlMs = this.options.pairingTtlMinutes * 60 * 1000;
        const pairing = this.pairingStore.createPairingCode(chatId, this.options.pairingCodeLength, ttlMs);
        if (pairing.code) {
          await this.client.sendMessage(chatId, `Pairing code: ${pairing.code}`);
        }
      }
      return;
    }

    await this.handleMessage(message, isGroup);
  }

  private async handleMessage(message: TelegramMessage, isGroup: boolean): Promise<void> {
    const chatId = String(message.chat.id);
    const session = this.options.sessionManager.getOrCreateSession({
      type: isGroup ? 'group' : 'main',
      groupId: isGroup ? chatId : undefined,
      source: 'telegram',
    });

    const result = await this.options.agentIntegration.run(
      message.text || '',
      this.options.getSystemPrompt(),
      {
        sessionId: session.sessionId,
      }
    );

    if (result.response) {
      await this.client.sendMessage(chatId, result.response, message.message_id);
    }
  }

  private isAllowed(chatId: string, isGroup: boolean): boolean {
    const allowlist = isGroup && this.options.groupAllowFrom.length > 0
      ? this.options.groupAllowFrom
      : this.options.allowFrom;

    if (allowlist.length > 0) {
      return allowlist.includes(chatId) || this.pairingStore.isAllowed(chatId);
    }

    return this.pairingStore.isAllowed(chatId);
  }
}
