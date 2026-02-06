import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { SkillRegistryClient } from '../../src/skills/registry-client.js';

describe('SkillRegistryClient', () => {
  let tempDir: string;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('lists and caches registry skills', async () => {
    tempDir = join(os.tmpdir(), `openclaw-lite-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [{ name: 'alpha', version: '1.0.0' }] })
      });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const client = new SkillRegistryClient('https://registry.example/skills.json', join(tempDir, 'cache.json'));
    const skills = await client.listSkills();

    expect(skills.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cached = await client.listSkills();
    expect(cached.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves files from download URL', async () => {
    tempDir = join(os.tmpdir(), `openclaw-lite-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [{ name: 'beta', version: '1.0.0', downloadUrl: 'https://registry.example/beta.json' }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ files: [{ path: 'index.js', content: 'console.log("hi")' }] })
      });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const client = new SkillRegistryClient('https://registry.example/skills.json', join(tempDir, 'cache.json'));
    const skill = await client.findSkill('beta');
    expect(skill).toBeDefined();

    const files = await client.resolveSkillFiles(skill!);
    expect(files.length).toBe(1);
    expect(files[0].path).toBe('index.js');
  });
});
