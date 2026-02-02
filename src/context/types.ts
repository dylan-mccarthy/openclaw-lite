export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens?: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ContextConfig {
  maxContextTokens: number;
  reservedTokens: number;
  compressionStrategy: 'truncate' | 'summarize' | 'selective' | 'hybrid';
  keepFirstLast: boolean;
  maxMessagesToKeep: number;
}

export interface CompressionResult {
  messages: Message[];
  originalTokenCount: number;
  compressedTokenCount: number;
  compressionRatio: number;
  removedMessages: number;
  strategyUsed: string;
}

export interface ModelProfile {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  isLocal: boolean;
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

export interface TaskRequirements {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  needsTools: boolean;
  needsVision: boolean;
  priority: 'speed' | 'cost' | 'quality' | 'local';
}

export interface ModelSelection {
  modelId: string;
  reason: string;
  estimatedCost?: number;
  contextWindow: number;
}