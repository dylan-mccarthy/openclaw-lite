import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getOllamaConfig, getContextConfig, getMemoryConfig, getModelSelectionConfig } from './env.js';

export interface OpenClawLiteConfig {
  ollama: {
    baseUrl: string;
    defaultModel: string;
    temperature: number;
    maxTokens: number;
  };
  context: {
    maxContextTokens: number;
    compressionStrategy: 'truncate' | 'selective' | 'hybrid';
    keepFirstLast: boolean;
  };
  memory: {
    enabled: boolean;
    storagePath: string;
    maxSessions: number;
    pruneDays: number;
  };
  modelSelection: {
    defaultPriority: 'local' | 'cost' | 'speed' | 'quality';
    fallbackModel: string;
  };
}

// Get default config from environment variables
const defaultConfig: OpenClawLiteConfig = {
  ollama: getOllamaConfig(),
  context: getContextConfig(),
  memory: {
    ...getMemoryConfig(),
    storagePath: join(process.env.HOME || process.cwd(), getMemoryConfig().storagePath),
  },
  modelSelection: getModelSelectionConfig(),
};

export class ConfigManager {
  private configPath: string;
  private config: OpenClawLiteConfig;

  constructor(configPath?: string) {
    this.configPath = configPath || join(
      process.env.HOME || process.cwd(),
      '.openclaw-lite',
      'config.json'
    );
    
    // Ensure directory exists
    const configDir = dirname(this.configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    
    this.config = this.loadConfig();
  }

  private loadConfig(): OpenClawLiteConfig {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf8');
        const userConfig = JSON.parse(content);
        return { ...defaultConfig, ...userConfig };
      }
    } catch (error) {
      console.warn(`Failed to load config from ${this.configPath}:`, error);
    }
    
    return { ...defaultConfig };
  }

  getConfig(): OpenClawLiteConfig {
    return this.config;
  }

  updateConfig(updates: Partial<OpenClawLiteConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  saveConfig(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      console.warn(`Failed to save config to ${this.configPath}:`, error);
    }
  }

  getOllamaConfig() {
    return this.config.ollama;
  }

  getContextConfig() {
    return this.config.context;
  }

  getMemoryConfig() {
    return this.config.memory;
  }

  getModelSelectionConfig() {
    return this.config.modelSelection;
  }
}

// Singleton instance
let configManager: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!configManager) {
    configManager = new ConfigManager();
  }
  return configManager;
}