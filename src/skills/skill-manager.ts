import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SkillVerifier } from '../security/skill-verifier.js';

export interface SkillExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
}

export class SkillManager {
  private skillsPath: string;
  private verifier: SkillVerifier;
  
  constructor(skillsPath: string = 'skills') {
    this.skillsPath = skillsPath;
    this.verifier = new SkillVerifier(skillsPath);
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