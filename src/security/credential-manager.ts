import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface CredentialDefinition {
  name: string;
  type: 'api_key' | 'oauth_token' | 'database_url' | 'ssh_key' | 'certificate' | 'password';
  description: string;
  required: boolean;
  scopes?: string[];
  prompt?: string;
  helpUrl?: string;
  validationRegex?: string;
  encrypted: boolean;
}

export interface SkillCredentialManifest {
  skillId: string;
  skillName: string;
  version: string;
  credentials: CredentialDefinition[];
  installedAt: number;
  lastAccessed?: number;
}

export interface StoredCredential {
  skillId: string;
  credentialName: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  createdAt: number;
  lastUsed?: number;
  usageCount: number;
}

export interface CredentialRequest {
  skillId: string;
  credentialName: string;
  context?: {
    operation: string;
    target?: string;
    reason?: string;
  };
}

export class CredentialManager {
  private vaultPath: string;
  private manifestsPath: string;
  private masterKey: Buffer;
  
  constructor(
    secureStoragePath: string = join(process.env.HOME || '', '.clawlite-secure'),
    masterKey?: string
  ) {
    this.vaultPath = join(secureStoragePath, 'credentials');
    this.manifestsPath = join(secureStoragePath, 'credential-manifests');
    
    // Derive or use provided master key
    if (masterKey) {
      this.masterKey = scryptSync(masterKey, 'openclaw-cred-salt', 32);
    } else {
      // Try to load from secure storage
      const keyPath = join(secureStoragePath, 'encryption.key');
      if (existsSync(keyPath)) {
        const key = readFileSync(keyPath, 'utf8').trim();
        this.masterKey = scryptSync(key, 'openclaw-cred-salt', 32);
      } else {
        throw new Error('No master key available for credential encryption');
      }
    }
    
    // Ensure directories exist
    [this.vaultPath, this.manifestsPath].forEach(path => {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    });
  }
  
  private encryptCredential(value: string): { encrypted: string; iv: string; authTag: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv) as any;
    
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    return { encrypted, iv: iv.toString('hex'), authTag };
  }
  
  private decryptCredential(encrypted: string, iv: string, authTag: string): string {
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(iv, 'hex')) as any;
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  async registerSkillCredentials(
    skillId: string,
    skillName: string,
    version: string,
    credentials: CredentialDefinition[]
  ): Promise<SkillCredentialManifest> {
    const manifest: SkillCredentialManifest = {
      skillId,
      skillName,
      version,
      credentials,
      installedAt: Date.now()
    };
    
    const manifestPath = join(this.manifestsPath, `${skillId}.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    
    return manifest;
  }
  
  async installCredential(
    skillId: string,
    credentialName: string,
    value: string
  ): Promise<boolean> {
    // Check if skill has this credential defined
    const manifest = this.getSkillCredentialManifest(skillId);
    if (!manifest) {
      throw new Error(`No credential manifest found for skill: ${skillId}`);
    }
    
    const credentialDef = manifest.credentials.find(c => c.name === credentialName);
    if (!credentialDef) {
      throw new Error(`Credential ${credentialName} not defined for skill ${skillId}`);
    }
    
    // Validate if needed
    if (credentialDef.validationRegex) {
      const regex = new RegExp(credentialDef.validationRegex);
      if (!regex.test(value)) {
        throw new Error(`Credential ${credentialName} does not match validation pattern`);
      }
    }
    
    // Encrypt and store
    const { encrypted, iv, authTag } = this.encryptCredential(value);
    const storedCredential: StoredCredential = {
      skillId,
      credentialName,
      encryptedValue: encrypted,
      iv,
      authTag,
      createdAt: Date.now(),
      usageCount: 0
    };
    
    const credentialPath = join(this.vaultPath, `${skillId}.${credentialName}.json`);
    writeFileSync(credentialPath, JSON.stringify(storedCredential, null, 2), 'utf8');
    
    return true;
  }
  
  async getCredential(request: CredentialRequest): Promise<string | null> {
    const { skillId, credentialName } = request;
    
    // Check manifest
    const manifest = this.getSkillCredentialManifest(skillId);
    if (!manifest) {
      console.warn(`No credential manifest for skill: ${skillId}`);
      return null;
    }
    
    // Check if credential is defined
    const credentialDef = manifest.credentials.find(c => c.name === credentialName);
    if (!credentialDef) {
      console.warn(`Credential ${credentialName} not defined for skill ${skillId}`);
      return null;
    }
    
    // Load stored credential
    const credentialPath = join(this.vaultPath, `${skillId}.${credentialName}.json`);
    if (!existsSync(credentialPath)) {
      console.warn(`Credential ${credentialName} not installed for skill ${skillId}`);
      return null;
    }
    
    try {
      const stored = JSON.parse(readFileSync(credentialPath, 'utf8')) as StoredCredential;
      
      // Decrypt
      const value = this.decryptCredential(
        stored.encryptedValue,
        stored.iv,
        stored.authTag
      );
      
      // Update usage stats
      stored.lastUsed = Date.now();
      stored.usageCount++;
      writeFileSync(credentialPath, JSON.stringify(stored, null, 2), 'utf8');
      
      // Log access
      this.logCredentialAccess(request, stored);
      
      return value;
    } catch (error) {
      console.error(`Failed to decrypt credential ${credentialName}:`, error);
      return null;
    }
  }
  
  async hasCredential(skillId: string, credentialName: string): Promise<boolean> {
    const credentialPath = join(this.vaultPath, `${skillId}.${credentialName}.json`);
    return existsSync(credentialPath);
  }
  
  async listSkillCredentials(skillId: string): Promise<{ installed: string[]; required: string[] }> {
    const manifest = this.getSkillCredentialManifest(skillId);
    if (!manifest) {
      return { installed: [], required: [] };
    }
    
    const installed: string[] = [];
    const required = manifest.credentials
      .filter(c => c.required)
      .map(c => c.name);
    
    // Check which credentials are installed
    for (const cred of manifest.credentials) {
      if (await this.hasCredential(skillId, cred.name)) {
        installed.push(cred.name);
      }
    }
    
    return { installed, required };
  }
  
  async revokeCredential(skillId: string, credentialName: string): Promise<boolean> {
    const credentialPath = join(this.vaultPath, `${skillId}.${credentialName}.json`);
    
    if (existsSync(credentialPath)) {
      // Instead of deleting, mark as revoked (safer)
      const stored = JSON.parse(readFileSync(credentialPath, 'utf8')) as StoredCredential;
      stored.encryptedValue = 'REVOKED';
      stored.iv = 'REVOKED';
      stored.authTag = 'REVOKED';
      writeFileSync(credentialPath, JSON.stringify(stored, null, 2), 'utf8');
      
      this.logRevocation(skillId, credentialName);
      return true;
    }
    
    return false;
  }
  
  async rotateCredential(
    skillId: string,
    credentialName: string,
    newValue: string
  ): Promise<boolean> {
    const manifest = this.getSkillCredentialManifest(skillId);
    if (!manifest) {
      return false;
    }
    
    const credentialDef = manifest.credentials.find(c => c.name === credentialName);
    if (!credentialDef) {
      return false;
    }
    
    // Validate new value
    if (credentialDef.validationRegex) {
      const regex = new RegExp(credentialDef.validationRegex);
      if (!regex.test(newValue)) {
        throw new Error(`New credential value does not match validation pattern`);
      }
    }
    
    // Install new credential (overwrites old)
    return this.installCredential(skillId, credentialName, newValue);
  }
  
  getSkillCredentialManifest(skillId: string): SkillCredentialManifest | null {
    const manifestPath = join(this.manifestsPath, `${skillId}.json`);
    
    if (existsSync(manifestPath)) {
      try {
        return JSON.parse(readFileSync(manifestPath, 'utf8')) as SkillCredentialManifest;
      } catch (error) {
        console.error(`Failed to parse credential manifest for ${skillId}:`, error);
      }
    }
    
    return null;
  }
  
  getAllSkillManifests(): SkillCredentialManifest[] {
    if (!existsSync(this.manifestsPath)) {
      return [];
    }
    
    const manifests: SkillCredentialManifest[] = [];
    const fs = require('fs');
    
    const files = fs.readdirSync(this.manifestsPath)
      .filter((file: string) => file.endsWith('.json'));
    
    files.forEach((file: string) => {
      try {
        const manifestPath = join(this.manifestsPath, file);
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SkillCredentialManifest;
        manifests.push(manifest);
      } catch (error) {
        console.error(`Failed to load manifest ${file}:`, error);
      }
    });
    
    return manifests;
  }
  
  private logCredentialAccess(request: CredentialRequest, stored: StoredCredential): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      skillId: request.skillId,
      credentialName: request.credentialName,
      context: request.context,
      usageCount: stored.usageCount
    };
    
    const logPath = join(this.vaultPath, '..', 'credential-access.log');
    const logLine = JSON.stringify(logEntry) + '\n';
    
    // Append to log file
    writeFileSync(logPath, logLine, { flag: 'a' });
  }
  
  private logRevocation(skillId: string, credentialName: string): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action: 'revocation',
      skillId,
      credentialName
    };
    
    const logPath = join(this.vaultPath, '..', 'credential-access.log');
    const logLine = JSON.stringify(logEntry) + '\n';
    
    writeFileSync(logPath, logLine, { flag: 'a' });
  }
  
  async validateSkillCredentials(skillId: string): Promise<{
    valid: boolean;
    missing: string[];
    installed: string[];
    warnings: string[];
  }> {
    const manifest = this.getSkillCredentialManifest(skillId);
    if (!manifest) {
      return {
        valid: false,
        missing: [],
        installed: [],
        warnings: ['No credential manifest found']
      };
    }
    
    const missing: string[] = [];
    const installed: string[] = [];
    const warnings: string[] = [];
    
    for (const cred of manifest.credentials) {
      if (await this.hasCredential(skillId, cred.name)) {
        installed.push(cred.name);
      } else if (cred.required) {
        missing.push(cred.name);
      }
    }
    
    return {
      valid: missing.length === 0,
      missing,
      installed,
      warnings
    };
  }
}