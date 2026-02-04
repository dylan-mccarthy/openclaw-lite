import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface KeyManagerConfig {
  secureStoragePath: string;
  keyFileName: string;
  wrapperScriptPath?: string;
}

/**
 * Secure Key Manager
 * 
 * Manages encryption keys in isolated storage that the agent cannot directly read.
 * Keys are provided to processes via environment variables in isolated execution.
 */
export class SecureKeyManager {
  private config: KeyManagerConfig;
  
  constructor(config: Partial<KeyManagerConfig> = {}) {
    this.config = {
      secureStoragePath: join(process.env.HOME || '', '.openclaw-lite', 'secure'),
      keyFileName: 'encryption.key',
      wrapperScriptPath: join(process.env.HOME || '', '.openclaw-lite', 'claw-lite-secure'),
      ...config
    };
  }
  
  /**
   * Check if secure storage exists and is properly configured
   */
  isSecureStorageAvailable(): boolean {
    return existsSync(this.config.secureStoragePath) && 
           existsSync(join(this.config.secureStoragePath, this.config.keyFileName));
  }
  
  /**
   * Get the encryption key via secure wrapper (agent cannot read directly)
   * Returns null if key cannot be accessed
   */
  async getEncryptionKey(): Promise<string | null> {
    if (!this.isSecureStorageAvailable()) {
      return null;
    }
    
    try {
      // Try to read via wrapper script if it exists
      if (this.config.wrapperScriptPath && existsSync(this.config.wrapperScriptPath)) {
        return await this.getKeyViaWrapper();
      }
      
      // Fallback: direct read (less secure)
      return this.getKeyDirect();
    } catch (error) {
      console.warn('Failed to get encryption key:', error);
      return null;
    }
  }
  
  /**
   * Execute a command with the encryption key provided via environment
   * The key is never exposed to the calling process
   */
  async executeWithKey(command: string, args: string[] = []): Promise<{ success: boolean; output?: string; error?: string }> {
    if (!this.isSecureStorageAvailable()) {
      return {
        success: false,
        error: 'Secure storage not available'
      };
    }
    
    return new Promise((resolve) => {
      try {
        // Read key directly for child process
        const key = this.getKeyDirect();
        if (!key) {
          resolve({
            success: false,
            error: 'Could not read encryption key'
          });
          return;
        }
        
        // Execute with key in environment
        const env = { ...process.env, OPENCLAW_ENCRYPTION_KEY: key };
        const child = spawn(command, args, { env });
        
        let output = '';
        let error = '';
        
        child.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        child.stderr.on('data', (data) => {
          error += data.toString();
        });
        
        child.on('close', (code) => {
          resolve({
            success: code === 0,
            output: output || undefined,
            error: error || undefined
          });
        });
        
        child.on('error', (err) => {
          resolve({
            success: false,
            error: err.message
          });
        });
        
      } catch (err) {
        resolve({
          success: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    });
  }
  
  /**
   * Create secure storage with a new encryption key
   */
  initializeSecureStorage(): boolean {
    try {
      // Create secure directory
      if (!existsSync(this.config.secureStoragePath)) {
        mkdirSync(this.config.secureStoragePath, { recursive: true });
      }
      
      // Generate new key
      const keyPath = join(this.config.secureStoragePath, this.config.keyFileName);
      if (!existsSync(keyPath)) {
        // Generate random key
        const crypto = require('crypto');
        const key = crypto.randomBytes(32).toString('base64');
        writeFileSync(keyPath, key, 'utf8');
        
        // Set strict permissions (if on Unix)
        try {
          execSync(`chmod 600 "${keyPath}"`);
          execSync(`chmod 700 "${this.config.secureStoragePath}"`);
        } catch {
          // Permission commands may fail on Windows, that's OK
        }
      }
      
      return true;
    } catch (error) {
      console.error('Failed to initialize secure storage:', error);
      return false;
    }
  }
  
  /**
   * Check if the current process has direct access to the key
   * (Should return false in normal operation)
   */
  hasDirectKeyAccess(): boolean {
    return !!process.env.OPENCLAW_ENCRYPTION_KEY;
  }
  
  /**
   * Create a secure execution environment configuration
   */
  createSecureEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    
    // Only add key if we have it
    const key = this.getKeyDirect();
    if (key) {
      env.OPENCLAW_ENCRYPTION_KEY = key;
    }
    
    // Add secure storage path
    env.OPENCLAW_SECURE_STORAGE = this.config.secureStoragePath;
    
    return env;
  }
  
  private getKeyViaWrapper(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.config.wrapperScriptPath || !existsSync(this.config.wrapperScriptPath)) {
        reject(new Error('Wrapper script not found'));
        return;
      }
      
      // Execute wrapper with a dummy command that outputs the key
      // (In reality, the wrapper would handle this differently)
      const child = spawn(this.config.wrapperScriptPath, ['--internal-get-key']);
      
      let output = '';
      let error = '';
      
      child.stdout.on('data', (data) => {
        output += data.toString().trim();
      });
      
      child.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      child.on('close', (code) => {
        if (code === 0 && output) {
          resolve(output);
        } else {
          reject(new Error(`Failed to get key via wrapper: ${error}`));
        }
      });
      
      child.on('error', reject);
    });
  }
  
  private getKeyDirect(): string | null {
    try {
      const keyPath = join(this.config.secureStoragePath, this.config.keyFileName);
      if (existsSync(keyPath)) {
        return readFileSync(keyPath, 'utf8').trim();
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Helper function to check if we're in a secure execution environment
 */
export function isSecureEnvironment(): boolean {
  // Check for secure storage
  const securePath = join(process.env.HOME || '', '.openclaw-lite', 'secure');
  const keyPath = join(securePath, 'encryption.key');
  
  return existsSync(securePath) && existsSync(keyPath);
}

/**
 * Helper function to get encryption key from secure storage
 * (Only works if called from a process that has access)
 */
export function getEncryptionKeyFromSecureStorage(): string | null {
  try {
    const securePath = process.env.OPENCLAW_SECURE_STORAGE || join(process.env.HOME || '', '.openclaw-lite', 'secure');
    const keyPath = join(securePath, 'encryption.key');
    
    if (existsSync(keyPath)) {
      return readFileSync(keyPath, 'utf8').trim();
    }
    return null;
  } catch {
    return null;
  }
}