import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

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
  authFlow?: 'manual' | 'oauth';
  oauth?: {
    provider?: string;
    authUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
  };
}

export interface SkillCredentialManifest {
  skillId: string;
  skillName: string;
  version: string;
  credentials: CredentialDefinition[];
  schemaHash: string;
  skillHash?: string;
  installedAt: number;
  confirmedAt?: number;
  needsConfirmation?: boolean;
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

export interface OAuthRequest {
  requestId: string;
  skillId: string;
  credentialName: string;
  provider?: string;
  authUrl: string;
  scopes?: string[];
  createdAt: number;
  status: 'pending' | 'completed';
}

export class CredentialManager {
  private vaultPath: string;
  private manifestsPath: string;
  private oauthRequestsPath: string;
  private masterKey: Buffer;
  
  constructor(
    secureStoragePath: string = join(process.env.HOME || '', '.openclaw-lite', 'secure'),
    masterKey?: string
  ) {
    this.vaultPath = join(secureStoragePath, 'credentials');
    this.manifestsPath = join(secureStoragePath, 'credential-manifests');
    this.oauthRequestsPath = join(secureStoragePath, 'oauth-requests');
    
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
    [this.vaultPath, this.manifestsPath, this.oauthRequestsPath].forEach(path => {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    });
  }
  
  private calculateSchemaHash(credentials: CredentialDefinition[]): string {
    const normalized = credentials
      .map((cred) => ({
        name: cred.name,
        type: cred.type,
        required: cred.required,
        scopes: cred.scopes || [],
        helpUrl: cred.helpUrl || '',
        validationRegex: cred.validationRegex || '',
        encrypted: cred.encrypted,
        authFlow: cred.authFlow || 'manual',
        oauth: cred.oauth
          ? {
              provider: cred.oauth.provider || '',
              authUrl: cred.oauth.authUrl || '',
              tokenUrl: cred.oauth.tokenUrl || '',
              scopes: cred.oauth.scopes || []
            }
          : undefined
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    return createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
  }
  
  private isDevCredentialFallbackEnabled(): boolean {
    return process.env.NODE_ENV === 'development' || process.env.OPENCLAW_DEV_CREDENTIALS === '1';
  }
  
  private getEnvFallbackCredential(skillId: string, credentialName: string): string | null {
    if (!this.isDevCredentialFallbackEnabled()) {
      return null;
    }
    
    const normalize = (value: string) => value
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_');
    
    const skillScopedKey = `${normalize(skillId)}_${normalize(credentialName)}`;
    const simpleKey = normalize(credentialName);
    
    return process.env[skillScopedKey] || process.env[simpleKey] || null;
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
    credentials: CredentialDefinition[],
    skillHash?: string
  ): Promise<SkillCredentialManifest> {
    const schemaHash = this.calculateSchemaHash(credentials);
    const existing = this.getSkillCredentialManifest(skillId);
    const needsConfirmation = existing ? existing.schemaHash !== schemaHash : false;
    
    const manifest: SkillCredentialManifest = {
      skillId,
      skillName,
      version,
      credentials,
      schemaHash,
      skillHash,
      installedAt: Date.now(),
      confirmedAt: needsConfirmation ? undefined : existing?.confirmedAt,
      needsConfirmation
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
  
  async createOAuthRequest(
    skillId: string,
    credentialName: string,
    authUrl: string,
    provider?: string,
    scopes?: string[]
  ): Promise<OAuthRequest> {
    const requestId = randomBytes(16).toString('hex');
    const request: OAuthRequest = {
      requestId,
      skillId,
      credentialName,
      provider,
      authUrl,
      scopes,
      createdAt: Date.now(),
      status: 'pending'
    };
    
    const requestPath = join(this.oauthRequestsPath, `${requestId}.json`);
    writeFileSync(requestPath, JSON.stringify(request, null, 2), 'utf8');
    
    return request;
  }
  
  getOAuthRequest(requestId: string): OAuthRequest | null {
    const requestPath = join(this.oauthRequestsPath, `${requestId}.json`);
    if (!existsSync(requestPath)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(requestPath, 'utf8')) as OAuthRequest;
    } catch {
      return null;
    }
  }
  
  listOAuthRequests(skillId?: string): OAuthRequest[] {
    if (!existsSync(this.oauthRequestsPath)) {
      return [];
    }
    const fs = require('fs');
    const files = fs.readdirSync(this.oauthRequestsPath)
      .filter((file: string) => file.endsWith('.json'));
    
    return files.map((file: string) => {
      const requestPath = join(this.oauthRequestsPath, file);
      return JSON.parse(readFileSync(requestPath, 'utf8')) as OAuthRequest;
    }).filter((request: OAuthRequest) => !skillId || request.skillId === skillId);
  }
  
  async completeOAuthRequest(requestId: string, token: string): Promise<boolean> {
    const request = this.getOAuthRequest(requestId);
    if (!request) {
      return false;
    }
    
    const success = await this.installCredential(
      request.skillId,
      request.credentialName,
      token
    );
    
    if (success) {
      request.status = 'completed';
      const requestPath = join(this.oauthRequestsPath, `${requestId}.json`);
      writeFileSync(requestPath, JSON.stringify(request, null, 2), 'utf8');
      return true;
    }
    
    return false;
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
    
    if (manifest.needsConfirmation) {
      console.warn(`Credential access blocked: ${skillId} credentials require confirmation after manifest change`);
      return null;
    }
    
    // Load stored credential
    const credentialPath = join(this.vaultPath, `${skillId}.${credentialName}.json`);
    if (!existsSync(credentialPath)) {
      const envValue = this.getEnvFallbackCredential(skillId, credentialName);
      if (envValue) {
        console.warn(`⚠️  Using dev env credential for ${skillId}.${credentialName}. Set OPENCLAW_DEV_CREDENTIALS=1 and NODE_ENV=development only.`);
        return envValue;
      }
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
  
  hasCredential(skillId: string, credentialName: string): boolean {
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
      if (this.hasCredential(skillId, cred.name)) {
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
  
  needsCredentialConfirmation(skillId: string): boolean {
    const manifest = this.getSkillCredentialManifest(skillId);
    return !!manifest?.needsConfirmation;
  }
  
  confirmSkillCredentials(skillId: string): boolean {
    const manifest = this.getSkillCredentialManifest(skillId);
    if (!manifest) {
      return false;
    }
    
    manifest.needsConfirmation = false;
    manifest.confirmedAt = Date.now();
    
    const manifestPath = join(this.manifestsPath, `${skillId}.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return true;
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
  
  validateSkillCredentials(skillId: string): {
    valid: boolean;
    missing: string[];
    installed: string[];
    warnings: string[];
  } {
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
      const envFallback = this.getEnvFallbackCredential(skillId, cred.name);
      if (this.hasCredential(skillId, cred.name) || envFallback) {
        installed.push(cred.name);
        if (envFallback) {
          warnings.push(`Using dev env fallback for ${cred.name}`);
        }
      } else if (cred.required) {
        missing.push(cred.name);
      }
    }
    
    if (manifest.needsConfirmation) {
      warnings.push('Credentials require confirmation after manifest change');
    }
    
    return {
      valid: missing.length === 0 && !manifest.needsConfirmation,
      missing,
      installed,
      warnings
    };
  }
}