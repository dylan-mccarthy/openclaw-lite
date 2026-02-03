import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SkillVerifier } from '../security/skill-verifier.js';
import { CredentialManager } from '../security/credential-manager.js';

export interface SkillExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
}

export class SkillManager {
  private skillsPath: string;
  private verifier: SkillVerifier;
  private credentialManager?: CredentialManager;
  
  constructor(skillsPath: string = 'skills', credentialManager?: CredentialManager) {
    this.skillsPath = skillsPath;
    this.credentialManager = credentialManager;
    this.verifier = new SkillVerifier(skillsPath, credentialManager);
  }
  
  getVerifier(): SkillVerifier {
    return this.verifier;
  }
  
  // Strict verification: do not execute unverified skills
  executeSkill(skillName: string, ...args: any[]): SkillExecutionResult {
    const isVerified = this.verifier.verifySkill(skillName);
    if (!isVerified) {
      return {
        success: false,
        error: `Skill '${skillName}' is not verified or hash mismatch. Execution denied.`
      };
    }
    
    if (this.credentialManager) {
      const validation = this.credentialManager.validateSkillCredentials(skillName);
      if (!validation.valid) {
        const details = validation.missing.length > 0
          ? `Missing required credentials: ${validation.missing.join(', ')}`
          : 'Credentials require confirmation after manifest change';
        return {
          success: false,
          error: `Skill '${skillName}' cannot run. ${details}`
        };
      }
    }
    
    const skillPath = join(this.skillsPath, skillName);
    const manifestPath = join(skillPath, 'manifest.json');
    
    if (!existsSync(manifestPath)) {
      return {
        success: false,
        error: `Skill '${skillName}' missing manifest.json`
      };
    }
    
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const entryPoint = manifest.entryPoint || 'index.js';
      const entryFile = join(skillPath, entryPoint);
      
      if (!existsSync(entryFile)) {
        return {
          success: false,
          error: `Skill '${skillName}' entry point not found: ${entryPoint}`
        };
      }
      
      // Dynamic import for ES modules
      const skillModule = require(entryFile);
      
      if (typeof skillModule.default === 'function') {
        const output = skillModule.default(...args);
        return { success: true, output };
      }
      
      if (typeof skillModule.run === 'function') {
        const output = skillModule.run(...args);
        return { success: true, output };
      }
      
      return {
        success: false,
        error: `Skill '${skillName}' does not export a default or run() function`
      };
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}