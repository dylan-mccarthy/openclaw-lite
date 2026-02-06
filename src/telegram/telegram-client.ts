export interface TelegramClientOptions {
  botToken: string;
}

export interface TelegramSendMessageResult {
  ok: boolean;
  result?: unknown;
  description?: string;
}

export interface TelegramUpdateResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  entities?: TelegramEntity[];
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
}

export class TelegramClient {
  private baseUrl: string;

  constructor(options: TelegramClientOptions) {
    this.baseUrl = `https://api.telegram.org/bot${options.botToken}`;
  }

  async sendMessage(chatId: string, text: string, replyToMessageId?: number): Promise<TelegramSendMessageResult> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };

    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId;
    }

    const response = await fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return response.json() as Promise<TelegramSendMessageResult>;
  }

  async getUpdates(options: { offset?: number; timeout?: number } = {}): Promise<TelegramUpdateResponse> {
    const params = new URLSearchParams();
    if (options.offset) {
      params.set('offset', String(options.offset));
    }
    if (options.timeout) {
      params.set('timeout', String(options.timeout));
    }

    const url = `${this.baseUrl}/getUpdates?${params.toString()}`;
    const response = await fetch(url);
    return response.json() as Promise<TelegramUpdateResponse>;
  }

  async setWebhook(url: string): Promise<{ ok: boolean; description?: string }> {
    const response = await fetch(`${this.baseUrl}/setWebhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    return response.json() as Promise<{ ok: boolean; description?: string }>;
  }
}
