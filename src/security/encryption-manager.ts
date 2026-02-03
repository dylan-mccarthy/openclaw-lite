import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface EncryptionConfig {
  algorithm: string;
  keyDerivationSalt: string;
  ivLength: number;
  keyLength: number;
}

export class EncryptionManager {
  private config: EncryptionConfig;
  private key: Buffer;
  
  constructor(
    password: string,
    config: Partial<EncryptionConfig> = {}
  ) {
    this.config = {
      algorithm: 'aes-256-gcm',
      keyDerivationSalt: 'openclaw-lite-salt',
      ivLength: 16,
      keyLength: 32,
      ...config
    };
    
    // Derive key from password
    this.key = scryptSync(
      password,
      this.config.keyDerivationSalt,
      this.config.keyLength
    );
  }
  
  encrypt(text: string): string {
    const iv = randomBytes(this.config.ivLength);
    const cipher = createCipheriv(this.config.algorithm, this.key, iv) as any;
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Combine IV + authTag + encrypted data
    return Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, 'hex')
    ]).toString('base64');
  }
  
  decrypt(encryptedBase64: string): string {
    const buffer = Buffer.from(encryptedBase64, 'base64');
    
    // Extract components
    const iv = buffer.slice(0, this.config.ivLength);
    const authTag = buffer.slice(this.config.ivLength, this.config.ivLength + 16);
    const encrypted = buffer.slice(this.config.ivLength + 16);
    
    const decipher = createDecipheriv(this.config.algorithm, this.key, iv) as any;
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  encryptFile(inputPath: string, outputPath?: string): void {
    const content = readFileSync(inputPath, 'utf8');
    const encrypted = this.encrypt(content);
    
    const targetPath = outputPath || inputPath;
    const targetDir = dirname(targetPath);
    
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    
    writeFileSync(targetPath, encrypted, 'utf8');
  }
  
  decryptFile(inputPath: string, outputPath?: string): string {
    const encrypted = readFileSync(inputPath, 'utf8');
    const decrypted = this.decrypt(encrypted);
    
    if (outputPath) {
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      writeFileSync(outputPath, decrypted, 'utf8');
    }
    
    return decrypted;
  }
  
  isEncryptedFile(filePath: string): boolean {
    if (!existsSync(filePath)) {
      return false;
    }
    
    try {
      const content = readFileSync(filePath, 'utf8');
      // Check if content is base64 and has minimum length for our encrypted format
      if (!content.match(/^[A-Za-z0-9+/]+=*$/)) {
        return false;
      }
      
      const buffer = Buffer.from(content, 'base64');
      // Minimum size: IV (16) + authTag (16) + some encrypted data (at least 1)
      return buffer.length >= 33;
    } catch {
      return false;
    }
  }
}

// Helper functions for working with sensitive files
export class FileSecurityManager {
  private encryptionManager: EncryptionManager | null = null;
  private workspacePath: string;
  private encryptedExtensions = ['.md', '.json', '.txt'];
  private whitelist = [
    'README.md',
    'LICENSE',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    '.gitignore',
    '.env.example'
  ];
  
  constructor(
    workspacePath: string,
    encryptionKey?: string
  ) {
    this.workspacePath = workspacePath;
    
    if (encryptionKey) {
      this.encryptionManager = new EncryptionManager(encryptionKey);
    }
  }
  
  shouldEncrypt(filePath: string): boolean {
    const filename = filePath.split('/').pop() || '';
    
    // Check whitelist
    if (this.whitelist.includes(filename)) {
      return false;
    }
    
    // Check extension
    const shouldEncrypt = this.encryptedExtensions.some(ext => 
      filePath.toLowerCase().endsWith(ext.toLowerCase())
    );
    
    // Special handling for sensitive files
    const sensitiveFiles = [
      'SOUL.md',
      'USER.md', 
      'IDENTITY.md',
      'MEMORY.md',
      'AGENTS.md',
      'TOOLS.md',
      'HEARTBEAT.md',
      'BOOTSTRAP.md'
    ];
    
    if (sensitiveFiles.includes(filename)) {
      return true;
    }
    
    // Memory files
    if (filePath.includes('/memory/') && filePath.endsWith('.md')) {
      return true;
    }
    
    return shouldEncrypt;
  }
  
  readSecureFile(filePath: string): string {
    const fullPath = join(this.workspacePath, filePath);
    
    if (!this.encryptionManager) {
      // No encryption configured, read normally
      return readFileSync(fullPath, 'utf8');
    }
    
    if (this.shouldEncrypt(filePath)) {
      if (this.encryptionManager.isEncryptedFile(fullPath)) {
        return this.encryptionManager.decryptFile(fullPath);
      }
      // File exists but isn't encrypted yet - encrypt it on next write
    }
    
    return readFileSync(fullPath, 'utf8');
  }
  
  writeSecureFile(filePath: string, content: string): void {
    const fullPath = join(this.workspacePath, filePath);
    const dir = dirname(fullPath);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    if (!this.encryptionManager || !this.shouldEncrypt(filePath)) {
      writeFileSync(fullPath, content, 'utf8');
      return;
    }
    
    const encrypted = this.encryptionManager.encrypt(content);
    writeFileSync(fullPath, encrypted, 'utf8');
  }
  
  ensureEncrypted(filePath: string): void {
    if (!this.encryptionManager || !this.shouldEncrypt(filePath)) {
      return;
    }
    
    const fullPath = join(this.workspacePath, filePath);
    
    if (existsSync(fullPath) && !this.encryptionManager.isEncryptedFile(fullPath)) {
      // File exists but isn't encrypted - encrypt it
      this.encryptionManager.encryptFile(fullPath);
    }
  }
  
  ensureAllEncrypted(): void {
    if (!this.encryptionManager) {
      return;
    }
    
    // Check all files in workspace
    const fs = require('fs');
    const path = require('path');
    
    const walk = (dir: string) => {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          // Skip node_modules, .git, dist
          if (['node_modules', '.git', 'dist'].includes(file)) {
            continue;
          }
          walk(filePath);
        } else if (stat.isFile()) {
          const relativePath = path.relative(this.workspacePath, filePath);
          if (this.shouldEncrypt(relativePath)) {
            this.ensureEncrypted(relativePath);
          }
        }
      }
    };
    
    walk(this.workspacePath);
  }
}