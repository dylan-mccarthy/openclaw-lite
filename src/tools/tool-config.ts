import fs from 'fs/promises';
import path from 'path';

export interface ToolConfig {
  name: string;
  enabled: boolean;
  dangerous: boolean;
  requiresApproval: boolean;
  customDescription?: string;
  allowedUsers?: string[];
  rateLimit?: {
    callsPerMinute: number;
    callsPerHour: number;
  };
}

export interface ToolConfigManagerOptions {
  configPath: string;
  defaultDangerousTools?: string[];
}

export class ToolConfigManager {
  private config: Map<string, ToolConfig> = new Map();
  private configPath: string;
  private defaultDangerousTools: Set<string>;

  constructor(options: ToolConfigManagerOptions) {
    this.configPath = options.configPath;
    this.defaultDangerousTools = new Set(options.defaultDangerousTools || [
      'write', 'edit', 'exec', 'delete', 'move'
    ]);
    
    // Ensure config directory exists
    this.ensureConfigDir();
  }

  private ensureConfigDir(): void {
    const dir = path.dirname(this.configPath);
    try {
      fs.mkdir(dir, { recursive: true });
    } catch {
      // Directory might already exist
    }
  }

  async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const configs: ToolConfig[] = JSON.parse(data);
      
      this.config.clear();
      configs.forEach(toolConfig => {
        this.config.set(toolConfig.name, toolConfig);
      });
      
      console.log(`[Tool Config] Loaded ${configs.length} tool configurations`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('[Tool Config] No configuration file found, using defaults');
        await this.createDefaultConfig();
      } else {
        console.error('[Tool Config] Failed to load config:', error);
      }
    }
  }

  async saveConfig(): Promise<void> {
    const configs = Array.from(this.config.values());
    await fs.writeFile(
      this.configPath,
      JSON.stringify(configs, null, 2),
      'utf-8'
    );
    console.log(`[Tool Config] Saved ${configs.length} tool configurations`);
  }

  async createDefaultConfig(): Promise<void> {
    // Default configuration
    const defaultConfigs: ToolConfig[] = [
      { name: 'read', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'write', enabled: true, dangerous: true, requiresApproval: true },
      { name: 'edit', enabled: true, dangerous: true, requiresApproval: true },
      { name: 'list', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'exec', enabled: true, dangerous: true, requiresApproval: true },
      { name: 'git_status', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'git_log', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'search', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'mkdir', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'delete', enabled: true, dangerous: true, requiresApproval: true },
      { name: 'copy', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'move', enabled: true, dangerous: true, requiresApproval: true },
      { name: 'file_info', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'http_request', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'create_script', enabled: true, dangerous: true, requiresApproval: true },
      { name: 'env', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'ps', enabled: true, dangerous: false, requiresApproval: false },
      { name: 'kill', enabled: true, dangerous: true, requiresApproval: true },
    ];

    this.config.clear();
    defaultConfigs.forEach(config => {
      this.config.set(config.name, config);
    });

    await this.saveConfig();
  }

  getToolConfig(toolName: string): ToolConfig | null {
    return this.config.get(toolName) || null;
  }

  updateToolConfig(toolName: string, updates: Partial<ToolConfig>): ToolConfig {
    let config = this.config.get(toolName);
    
    if (!config) {
      // Create new config with defaults
      config = {
        name: toolName,
        enabled: true,
        dangerous: this.defaultDangerousTools.has(toolName),
        requiresApproval: this.defaultDangerousTools.has(toolName)
      };
    }
    
    const updatedConfig = { ...config, ...updates, name: toolName };
    this.config.set(toolName, updatedConfig);
    
    return updatedConfig;
  }

  getAllConfigs(): ToolConfig[] {
    return Array.from(this.config.values());
  }

  isToolEnabled(toolName: string): boolean {
    const config = this.getToolConfig(toolName);
    return config ? config.enabled : true; // Default to enabled
  }

  isToolDangerous(toolName: string): boolean {
    const config = this.getToolConfig(toolName);
    return config ? config.dangerous : this.defaultDangerousTools.has(toolName);
  }

  requiresApproval(toolName: string): boolean {
    const config = this.getToolConfig(toolName);
    return config ? config.requiresApproval : this.defaultDangerousTools.has(toolName);
  }

  async exportConfig(): Promise<string> {
    const configs = this.getAllConfigs();
    return JSON.stringify(configs, null, 2);
  }

  async importConfig(json: string): Promise<void> {
    const configs: ToolConfig[] = JSON.parse(json);
    
    this.config.clear();
    configs.forEach(config => {
      this.config.set(config.name, config);
    });
    
    await this.saveConfig();
  }
}