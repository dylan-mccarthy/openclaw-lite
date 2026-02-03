import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { CredentialManager, CredentialDefinition } from './credential-manager.js';

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

export interface SkillManifest {
  name: string;
  version: string;
  author?: string;
  description?: string;
  entryPoint: string;
  dependencies?: Record<string, string>;
  permissions?: string[];
  credentials?: CredentialDefinition[];
  hash: string;
  verified: boolean;
  installedAt: number;
  source?: string;
  sourceHash?: string;
}

export interface SkillScanResult {
  safe: boolean;
  issues: string[];
  warnings: string[];
  hash: string;
  fileCount: number;
}

export class SkillVerifier {
  private skillsPath: string;
  private manifestPath: string;
  private manifests: Map<string, SkillManifest> = new Map();
  private credentialManager?: CredentialManager;
  
  constructor(skillsPath: string = 'skills', credentialManager?: CredentialManager) {
    this.skillsPath = skillsPath;
    this.manifestPath = join(skillsPath, '.manifests.json');
    this.credentialManager = credentialManager;
    this.loadManifests();
  }
  
  private loadManifests(): void {
    if (existsSync(this.manifestPath)) {
      try {
        const content = readFileSync(this.manifestPath, 'utf8');
        const data = JSON.parse(content);
        
        if (Array.isArray(data)) {
          data.forEach((manifest: SkillManifest) => {
            this.manifests.set(manifest.name, manifest);
          });
        }
      } catch (error) {
        console.warn('Failed to load skill manifests:', error);
      }
    }
  }
  
  private parseSkillMetadata(skillPath: string): Partial<SkillManifest> {
    const metadataFiles = [
      join(skillPath, 'skill.json'),
      join(skillPath, 'package.json'),
      join(skillPath, 'manifest.json')
    ];
    
    for (const filePath of metadataFiles) {
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf8');
          const metadata = JSON.parse(content);
          
          const manifest: Partial<SkillManifest> = {
            name: metadata.name || require('path').basename(skillPath),
            version: metadata.version || '1.0.0',
            author: metadata.author,
            description: metadata.description,
            entryPoint: metadata.main || metadata.entryPoint || 'index.js',
            dependencies: metadata.dependencies,
          };
          
          // Parse credential definitions if present
          if (metadata.credentials && Array.isArray(metadata.credentials)) {
            manifest.credentials = metadata.credentials.map((cred: any) => ({
              name: cred.name || '',
              type: cred.type || 'api_key',
              description: cred.description || '',
              required: cred.required !== false,
              scopes: cred.scopes,
              prompt: cred.prompt,
              helpUrl: cred.helpUrl,
              validationRegex: cred.validationRegex,
              encrypted: cred.encrypted !== false,
            }));
          }
          
          return manifest;
        } catch (error) {
          console.warn(`Failed to parse metadata file ${filePath}:`, error);
        }
      }
    }
    
    // Return basic manifest if no metadata file found
    return {
      name: require('path').basename(skillPath),
      version: '1.0.0',
      entryPoint: 'index.js',
    };
  }
  
  private saveManifests(): void {
    const manifestsArray = Array.from(this.manifests.values());
    const dir = dirname(this.manifestPath);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    writeFileSync(
      this.manifestPath,
      JSON.stringify(manifestsArray, null, 2),
      'utf8'
    );
  }
  
  calculateHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
  
  calculateFileHash(filePath: string): string {
    const content = readFileSync(filePath, 'utf8');
    return this.calculateHash(content);
  }
  
  scanForPromptInjection(content: string): { safe: boolean; issues: string[]; warnings: string[] } {
    const issues: string[] = [];
    const warnings: string[] = [];
    
    // Common prompt injection patterns
    const dangerousPatterns = [
      // Direct system prompt manipulation
      { pattern: /system\s*:\s*["']/gi, message: 'Potential system prompt override' },
      { pattern: /ignore\s+(previous|all)\s+instructions/gi, message: 'Instruction ignoring pattern' },
      { pattern: /you\s+are\s+(now|no longer)/gi, message: 'Role reassignment attempt' },
      { pattern: /disregard\s+your\s+(previous|initial)/gi, message: 'Disregard instruction pattern' },
      
      // Code execution patterns
      { pattern: /eval\s*\(|Function\s*\(|setTimeout\s*\(|setInterval\s*\(/gi, message: 'Potential code execution' },
      { pattern: /child_process|exec|spawn|fork/gi, message: 'Child process execution' },
      { pattern: /require\s*\(|import\s*\(|fs\.|child_process\./gi, message: 'Dynamic import or file system access' },
      
      // File system patterns
      { pattern: /writeFileSync|appendFileSync|unlinkSync/gi, message: 'File system write operations' },
      { pattern: /readFileSync|readdirSync|statSync/gi, message: 'File system read operations' },
      
      // Network patterns
      { pattern: /fetch\s*\(|axios|http\.|https\./gi, message: 'Network requests' },
      { pattern: /process\.env/gi, message: 'Environment variable access' },
      
      // Shell patterns
      { pattern: /execSync|spawnSync/gi, message: 'Shell command execution' },
      { pattern: /bash|sh\s+-c|cmd\.exe/gi, message: 'Shell invocation' },
    ];
    
    // Check for patterns
    dangerousPatterns.forEach(({ pattern, message }) => {
      const matches = content.match(pattern);
      if (matches) {
        issues.push(`${message}: Found ${matches.length} occurrence(s)`);
      }
    });
    
    // Check for encoded payloads
    const encodedPatterns = [
      /base64_decode\s*\(/gi,
      /atob\s*\(/gi,
      /decodeURIComponent\s*\(/gi,
      /eval\s*\(\s*(atob|decodeURIComponent)\s*\(/gi,
    ];
    
    encodedPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        warnings.push(`Encoded payload decoding detected: ${matches.length} occurrence(s)`);
      }
    });
    
    // Check for suspicious comments
    const suspiciousComments = [
      /\/\/\s*(TODO|FIXME|HACK|XXX)\s*:?\s*(prompt|inject|bypass|ignore)/gi,
      /#\s*(TODO|FIXME|HACK|XXX)\s*:?\s*(prompt|inject|bypass|ignore)/gi,
      /\/\*.*?(prompt|inject|bypass|ignore).*?\*\//gis,
    ];
    
    suspiciousComments.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        warnings.push(`Suspicious comment found: ${matches.length} occurrence(s)`);
      }
    });
    
    // Check for excessive length (potential hidden payload)
    if (content.length > 100000) { // 100KB
      warnings.push(`Large file size (${content.length} bytes) - may contain hidden content`);
    }
    
    // Check for binary-looking content in text files
    const binaryLike = content.match(/[^\x00-\x7F]/g);
    if (binaryLike && binaryLike.length > content.length * 0.1) { // >10% non-ASCII
      warnings.push(`High non-ASCII character count (${binaryLike.length}) - possible binary data`);
    }
    
    return {
      safe: issues.length === 0,
      issues,
      warnings
    };
  }
  
  scanSkillDirectory(skillPath: string): SkillScanResult {
    const fs = require('fs');
    const path = require('path');
    
    const issues: string[] = [];
    const warnings: string[] = [];
    let fileCount = 0;
    let combinedContent = '';
    
    const scanDir = (dir: string) => {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          // Skip hidden directories and node_modules
          if (!file.startsWith('.') && file !== 'node_modules') {
            scanDir(filePath);
          }
        } else if (stat.isFile()) {
          fileCount++;
          
          // Skip binary files
          const ext = path.extname(file).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
            continue;
          }
          
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            combinedContent += `\n=== FILE: ${path.relative(skillPath, filePath)} ===\n${content}\n`;
            
            // Scan this file for issues
            const scanResult = this.scanForPromptInjection(content);
            issues.push(...scanResult.issues.map(issue => `${path.relative(skillPath, filePath)}: ${issue}`));
            warnings.push(...scanResult.warnings.map(warning => `${path.relative(skillPath, filePath)}: ${warning}`));
          } catch (error) {
            warnings.push(`${path.relative(skillPath, filePath)}: Could not read file (binary?)`);
          }
        }
      }
    };
    
    scanDir(skillPath);
    
    // Calculate hash of combined content
    const hash = this.calculateHash(combinedContent);
    
    return {
      safe: issues.length === 0,
      issues,
      warnings,
      hash,
      fileCount
    };
  }
  
  verifySkill(skillName: string): boolean {
    const manifest = this.manifests.get(skillName);
    if (!manifest || !manifest.verified) {
      return false;
    }
    
    const skillDir = join(this.skillsPath, skillName);
    if (!existsSync(skillDir)) {
      return false;
    }
    
    // Re-scan to verify hash matches
    const scanResult = this.scanSkillDirectory(skillDir);
    
    if (scanResult.hash !== manifest.hash) {
      console.warn(`Skill ${skillName} hash mismatch: expected ${manifest.hash}, got ${scanResult.hash}`);
      return false;
    }
    
    if (!scanResult.safe) {
      console.warn(`Skill ${skillName} failed safety check:`, scanResult.issues);
      return false;
    }
    
    return true;
  }
  
  installSkill(sourcePath: string, skillName: string, sourceUrl?: string): SkillScanResult {
    const targetPath = join(this.skillsPath, skillName);
    
    if (!existsSync(sourcePath)) {
      throw new Error(`Source path ${sourcePath} does not exist`);
    }
    
    // Scan the skill before copying
    const scanResult = this.scanSkillDirectory(sourcePath);
    
    if (!scanResult.safe) {
      throw new Error(`Skill ${skillName} failed safety check: ${scanResult.issues.join(', ')}`);
    }
    
    // Create target directory
    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true });
    }
    
    // Copy files to target
    cpSync(sourcePath, targetPath, { recursive: true });
    
    // Create manifest
    const manifest: SkillManifest = {
      name: skillName,
      version: '1.0.0', // Would parse from package.json or similar
      entryPoint: 'index.js', // Would detect from package.json
      hash: scanResult.hash,
      verified: true,
      installedAt: Date.now(),
      source: sourceUrl,
      sourceHash: sourceUrl ? this.calculateHash(sourceUrl) : undefined,
      permissions: [], // Would parse from skill metadata
    };
    
    // Save manifest
    this.manifests.set(skillName, manifest);
    this.saveManifests();
    
    return scanResult;
  }
  
  uninstallSkill(skillName: string): boolean {
    if (!this.manifests.has(skillName)) {
      return false;
    }
    
    // Remove skill directory
    const skillPath = join(this.skillsPath, skillName);
    
    try {
      rmSync(skillPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to remove skill directory ${skillPath}:`, error);
    }
    
    // Remove from manifests
    this.manifests.delete(skillName);
    this.saveManifests();
    
    return true;
  }
  
  listSkills(): SkillManifest[] {
    return Array.from(this.manifests.values());
  }
  
  getSkill(skillName: string): SkillManifest | undefined {
    return this.manifests.get(skillName);
  }
  
  validateSkillExecution(skillName: string, operation: string): boolean {
    const manifest = this.manifests.get(skillName);
    if (!manifest || !manifest.verified) {
      return false;
    }
    
    // Check permissions if specified
    if (manifest.permissions && manifest.permissions.length > 0) {
      // Simple permission check - in real implementation would check against operation
      const allowedOperations = ['read', 'write', 'execute', 'network'];
      if (!allowedOperations.includes(operation)) {
        console.warn(`Operation ${operation} not allowed for skill ${skillName}`);
        return false;
      }
    }
    
    return this.verifySkill(skillName);
  }
}