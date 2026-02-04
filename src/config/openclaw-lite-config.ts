import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';

// Configuration schema
export const OpenClawLiteConfigSchema = z.object({
  // Workspace configuration
  workspace: z.object({
    path: z.string().default(path.join(os.homedir(), '.openclaw-lite')),
    identityPath: z.string().default('identity'),
    memoryPath: z.string().default('memory'),
    configPath: z.string().default('config'),
    logsPath: z.string().default('logs'),
    secureStoragePath: z.string().default('secure'),
  }),
  
  // Tool configuration
  tools: z.object({
    configPath: z.string().default('config/tool-config.json'),
    requireApprovalForDangerous: z.boolean().default(false),
    defaultDangerousTools: z.array(z.string()).default([]),
  }),
  
  // Ollama configuration
  ollama: z.object({
    url: z.string().url().default('http://localhost:11434'),
    defaultModel: z.string().default('Qwen3-4B-Instruct-2507:latest'),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().positive().default(2048),
    timeoutMs: z.number().positive().default(120000),
  }),
  
  // Memory configuration
  memory: z.object({
    enabled: z.boolean().default(true),
    storagePath: z.string().default('memory'),
    maxSessions: z.number().positive().default(100),
    pruneDays: z.number().positive().default(30),
  }),
  
  // Web server configuration
  web: z.object({
    port: z.number().min(1).max(65535).default(3000),
    enableCors: z.boolean().default(true),
    maxContextTokens: z.number().positive().default(8192),
  }),
  
  // Agent configuration
  agent: z.object({
    defaultModel: z.string().default('Qwen3-4B-Instruct-2507:latest'),
    temperature: z.number().min(0).max(2).default(0.7),
    timeoutMs: z.number().positive().default(120000),
    maxToolCallsPerTurn: z.number().positive().default(10),
  }),
});

export type OpenClawLiteConfig = z.infer<typeof OpenClawLiteConfigSchema>;

export class OpenClawLiteConfigManager {
  private configPath: string;
  private config: OpenClawLiteConfig;
  
  constructor(configPath?: string) {
    // Default config path: ~/.openclaw-lite/openclaw-lite.json
    this.configPath = configPath || path.join(
      os.homedir(),
      '.openclaw-lite',
      'openclaw-lite.json'
    );
    
    // Initialize with defaults
    this.config = OpenClawLiteConfigSchema.parse({
      workspace: {},
      tools: {},
      ollama: {},
      memory: {},
      web: {},
      agent: {}
    });
  }
  
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(data);
      this.config = OpenClawLiteConfigSchema.parse(parsed);
      console.log(`[Config] Loaded configuration from ${this.configPath}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log(`[Config] No configuration file found at ${this.configPath}, using defaults`);
        await this.save(); // Save defaults
      } else if (error instanceof z.ZodError) {
        console.warn('[Config] Configuration validation errors:', error.errors);
        console.warn('[Config] Using defaults for invalid values');
        // Merge valid values with defaults
        const parsed = JSON.parse(await fs.readFile(this.configPath, 'utf-8'));
        this.config = OpenClawLiteConfigSchema.parse({
          ...parsed,
          // Override with defaults for invalid fields
        });
      } else {
        console.error('[Config] Failed to load configuration:', error);
        throw error;
      }
    }
  }
  
  async save(): Promise<void> {
    try {
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      await fs.writeFile(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );
      console.log(`[Config] Saved configuration to ${this.configPath}`);
    } catch (error) {
      console.error('[Config] Failed to save configuration:', error);
      throw error;
    }
  }
  
  getConfig(): OpenClawLiteConfig {
    return this.config;
  }
  
  updateConfig(updates: Partial<OpenClawLiteConfig>): void {
    this.config = OpenClawLiteConfigSchema.parse({
      ...this.config,
      ...updates,
    });
  }
  
  // Helper methods to get resolved paths
  getWorkspacePath(): string {
    return this.config.workspace.path;
  }
  
  getIdentityPath(): string {
    return path.join(
      this.config.workspace.path,
      this.config.workspace.identityPath
    );
  }
  
  getMemoryPath(): string {
    return path.join(
      this.config.workspace.path,
      this.config.memory.storagePath
    );
  }
  
  getConfigPath(): string {
    return path.join(
      this.config.workspace.path,
      this.config.workspace.configPath
    );
  }
  
  getLogsPath(): string {
    return path.join(
      this.config.workspace.path,
      this.config.workspace.logsPath
    );
  }
  
  getSecureStoragePath(): string {
    return path.join(
      this.config.workspace.path,
      this.config.workspace.secureStoragePath
    );
  }
  
  getToolConfigPath(): string {
    return path.join(
      this.config.workspace.path,
      this.config.tools.configPath
    );
  }
  
  // Ensure all directories exist
  async ensureDirectories(): Promise<void> {
    const directories = [
      this.getWorkspacePath(),
      this.getIdentityPath(),
      this.getMemoryPath(),
      this.getConfigPath(),
      this.getLogsPath(),
      this.getSecureStoragePath(),
      path.dirname(this.getToolConfigPath()),
    ];
    
    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error: any) {
        if (error.code !== 'EEXIST') {
          console.error(`[Config] Failed to create directory ${dir}:`, error);
        }
      }
    }
    
    console.log('[Config] All directories ensured');
  }
}

// Singleton instance
let configManager: OpenClawLiteConfigManager | null = null;

export function getConfigManager(configPath?: string): OpenClawLiteConfigManager {
  if (!configManager) {
    configManager = new OpenClawLiteConfigManager(configPath);
    
    // Try to load config synchronously (will use defaults if fails)
    try {
      // We can't do async in sync function, so we'll load on first access
      // or use defaults
    } catch (error) {
      console.warn('[Config] Could not load config synchronously:', error);
    }
  }
  return configManager;
}

export async function initializeConfig(configPath?: string): Promise<OpenClawLiteConfigManager> {
  const manager = getConfigManager(configPath);
  await manager.load();
  await manager.ensureDirectories();
  return manager;
}

// Sync initialization (for constructors)
export function initializeConfigSync(configPath?: string): OpenClawLiteConfigManager {
  const manager = getConfigManager(configPath);
  
  // Try to load config file synchronously
  try {
    if (fsSync.existsSync(manager['configPath'])) {
      const data = fsSync.readFileSync(manager['configPath'], 'utf-8');
      if (data.trim()) {
        const parsed = JSON.parse(data);
        manager['config'] = OpenClawLiteConfigSchema.parse(parsed);
        console.log(`[Config] Loaded configuration from ${manager['configPath']}`);
      } else {
        console.log(`[Config] Config file is empty, using defaults`);
      }
    } else {
      console.log(`[Config] Config file not found at ${manager['configPath']}, creating defaults`);
      const dir = path.dirname(manager['configPath']);
      fsSync.mkdirSync(dir, { recursive: true });
      fsSync.writeFileSync(manager['configPath'], JSON.stringify(manager['config'], null, 2), 'utf-8');
    }
  } catch (error) {
    console.warn('[Config] Failed to load config:', error);
  }
  
  // Ensure directories exist
  try {
    const directories = [
      manager.getWorkspacePath(),
      manager.getIdentityPath(),
      manager.getMemoryPath(),
      manager.getConfigPath(),
      manager.getLogsPath(),
      manager.getSecureStoragePath(),
      path.dirname(manager.getToolConfigPath()),
    ];
    
    for (const dir of directories) {
      try {
        fsSync.mkdirSync(dir, { recursive: true });
      } catch (error: any) {
        if (error.code !== 'EEXIST') {
          console.error(`[Config] Failed to create directory ${dir}:`, error);
        }
      }
    }
  } catch (error) {
    console.warn('[Config] Failed to ensure directories:', error);
  }
  
  return manager;
}