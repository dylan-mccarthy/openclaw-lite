import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CredentialManager } from '../../src/security/credential-manager.js';
import { SkillVerifier } from '../../src/security/skill-verifier.js';
import { SecureKeyManager } from '../../src/security/secure-key-manager.js';
import { join } from 'path';
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';

describe('CredentialManager', () => {
  let testDir: string;
  let credentialManager: CredentialManager;
  let keyManager: SecureKeyManager;

  beforeEach(() => {
    testDir = join(process.cwd(), 'test-temp-secure');
    keyManager = new SecureKeyManager({ secureStoragePath: testDir });
    keyManager.initializeSecureStorage();
    
    credentialManager = new CredentialManager(testDir, 'test-master-key-123');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should register skill credentials and compute schema hash', async () => {
    const credentials = [
      {
        name: 'github_token',
        type: 'oauth_token' as const,
        description: 'GitHub API token',
        required: true,
        encrypted: true
      }
    ];

    const manifest = await credentialManager.registerSkillCredentials(
      'github-skill',
      'GitHub Skill',
      '1.0.0',
      credentials
    );

    expect(manifest.skillId).toBe('github-skill');
    expect(manifest.credentials).toHaveLength(1);
    expect(manifest.schemaHash).toBeDefined();
    expect(manifest.needsConfirmation).toBe(false);
  });

  it('should detect manifest changes requiring confirmation', async () => {
    const credentials1 = [
      { name: 'token1', type: 'api_key' as const, description: 'Token 1', required: true, encrypted: true }
    ];

    const manifest1 = await credentialManager.registerSkillCredentials(
      'test-skill',
      'Test Skill',
      '1.0.0',
      credentials1
    );

    // Different credentials (new required credential)
    const credentials2 = [
      { name: 'token1', type: 'api_key' as const, description: 'Token 1', required: true, encrypted: true },
      { name: 'token2', type: 'api_key' as const, description: 'Token 2', required: true, encrypted: true }
    ];

    const manifest2 = await credentialManager.registerSkillCredentials(
      'test-skill',
      'Test Skill',
      '1.1.0',
      credentials2
    );

    expect(manifest2.needsConfirmation).toBe(true);
  });

  it('should install and retrieve credentials', async () => {
    const credentials = [
      {
        name: 'api_key',
        type: 'api_key' as const,
        description: 'Test API key',
        required: true,
        encrypted: true
      }
    ];

    await credentialManager.registerSkillCredentials(
      'test-skill',
      'Test Skill',
      '1.0.0',
      credentials
    );

    const success = await credentialManager.installCredential(
      'test-skill',
      'api_key',
      'secret-token-123'
    );

    expect(success).toBe(true);

    const retrieved = await credentialManager.getCredential({
      skillId: 'test-skill',
      credentialName: 'api_key'
    });

    expect(retrieved).toBe('secret-token-123');
  });

  it('should block access when credentials need confirmation', async () => {
    const credentials = [
      {
        name: 'api_key',
        type: 'api_key' as const,
        description: 'Test API key',
        required: true,
        encrypted: true
      }
    ];

    const manifest = await credentialManager.registerSkillCredentials(
      'test-skill',
      'Test Skill',
      '1.0.0',
      credentials
    );

    // Mark as needing confirmation
    const manifestPath = join(testDir, 'credential-manifests', 'test-skill.json');
    const updatedManifest = { ...manifest, needsConfirmation: true };
    writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2), 'utf8');

    const retrieved = await credentialManager.getCredential({
      skillId: 'test-skill',
      credentialName: 'api_key'
    });

    expect(retrieved).toBeNull();
  });

  it('should validate skill credentials correctly', () => {
    const credentials = [
      {
        name: 'required_key',
        type: 'api_key' as const,
        description: 'Required key',
        required: true,
        encrypted: true
      },
      {
        name: 'optional_key',
        type: 'api_key' as const,
        description: 'Optional key',
        required: false,
        encrypted: true
      }
    ];

    credentialManager.registerSkillCredentials(
      'test-skill',
      'Test Skill',
      '1.0.0',
      credentials
    );

    const validation = credentialManager.validateSkillCredentials('test-skill');
    
    expect(validation.valid).toBe(false); // Missing required credential
    expect(validation.missing).toContain('required_key');
    expect(validation.missing).not.toContain('optional_key');
  });
});

describe('SkillVerifier with Credentials', () => {
  let testSkillsDir: string;
  let skillVerifier: SkillVerifier;

  beforeEach(() => {
    testSkillsDir = join(process.cwd(), 'test-temp-skills');
    mkdirSync(testSkillsDir, { recursive: true });
    
    const keyManager = new SecureKeyManager();
    const credentialManager = new CredentialManager(undefined, 'test-key');
    skillVerifier = new SkillVerifier(testSkillsDir, credentialManager);
  });

  afterEach(() => {
    if (existsSync(testSkillsDir)) {
      rmSync(testSkillsDir, { recursive: true, force: true });
    }
  });

  it('should parse skill metadata with credentials', () => {
    const skillPath = join(testSkillsDir, 'test-skill');
    mkdirSync(skillPath, { recursive: true });
    
    const manifest = {
      name: 'test-skill',
      version: '1.0.0',
      description: 'Test skill with credentials',
      entryPoint: 'index.js',
      credentials: [
        {
          name: 'github_token',
          type: 'oauth_token',
          description: 'GitHub API token',
          required: true,
          encrypted: true
        }
      ]
    };

    writeFileSync(
      join(skillPath, 'skill.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    const metadata = skillVerifier.getSkill('test-skill');
    expect(metadata).toBeUndefined(); // Not installed yet

    const parsed = (skillVerifier as any).parseSkillMetadata(skillPath);
    expect(parsed.credentials).toHaveLength(1);
    expect(parsed.credentials?.[0].name).toBe('github_token');
  });

  it('should install skill with credential metadata', () => {
    const skillPath = join(testSkillsDir, 'source-skill');
    mkdirSync(skillPath, { recursive: true });
    
    const manifest = {
      name: 'github-skill',
      version: '1.0.0',
      description: 'GitHub integration',
      entryPoint: 'index.js',
      credentials: [
        {
          name: 'github_token',
          type: 'oauth_token',
          description: 'GitHub API token',
          required: true,
          encrypted: true,
          authFlow: 'oauth',
          oauth: {
            provider: 'github',
            authUrl: 'https://github.com/login/oauth/authorize',
            scopes: ['repo:read', 'user:read']
          }
        }
      ]
    };

    writeFileSync(
      join(skillPath, 'skill.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    // Add a simple index.js file
    writeFileSync(
      join(skillPath, 'index.js'),
      'module.exports = { run: () => "Hello" };',
      'utf8'
    );

    const result = skillVerifier.installSkill(skillPath, 'github-skill');
    
    expect(result.safe).toBe(true);
    expect(result.hash).toBeDefined();
    
    const installedSkill = skillVerifier.getSkill('github-skill');
    expect(installedSkill).toBeDefined();
    expect(installedSkill?.credentials).toHaveLength(1);
    expect(installedSkill?.credentials?.[0].authFlow).toBe('oauth');
  });
});

describe('Dev Environment Fallback', () => {
  let testDir: string;
  let credentialManager: CredentialManager;

  beforeEach(() => {
    testDir = join(process.cwd(), 'test-temp-dev');
    credentialManager = new CredentialManager(testDir, 'test-key');
    
    // Set dev mode
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.NODE_ENV;
    delete process.env.GITHUB_SKILL_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  it('should fallback to environment variables in dev mode', async () => {
    process.env.GITHUB_SKILL_GITHUB_TOKEN = 'env-token-123';
    
    const credentials = [
      {
        name: 'github_token',
        type: 'api_key' as const,
        description: 'GitHub token',
        required: true,
        encrypted: true
      }
    ];

    await credentialManager.registerSkillCredentials(
      'github-skill',
      'GitHub Skill',
      '1.0.0',
      credentials
    );

    const retrieved = await credentialManager.getCredential({
      skillId: 'github-skill',
      credentialName: 'github_token'
    });

    expect(retrieved).toBe('env-token-123');
  });

  it('should validate credentials with env fallback', () => {
    process.env.GITHUB_TOKEN = 'env-token-456';
    
    const credentials = [
      {
        name: 'github_token',
        type: 'api_key' as const,
        description: 'GitHub token',
        required: true,
        encrypted: true
      }
    ];

    credentialManager.registerSkillCredentials(
      'github-skill',
      'GitHub Skill',
      '1.0.0',
      credentials
    );

    const validation = credentialManager.validateSkillCredentials('github-skill');
    
    expect(validation.valid).toBe(true); // Env fallback satisfies requirement
    expect(validation.installed).toContain('github_token');
    expect(validation.warnings).toContain('Using dev env fallback for github_token');
  });
});