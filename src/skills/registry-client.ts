export interface RegistrySkillFile {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface RegistrySkill {
  name: string;
  version: string;
  description?: string;
  entryPoint?: string;
  files?: RegistrySkillFile[];
  downloadUrl?: string;
}

export interface RegistryResponse {
  skills: RegistrySkill[];
  fetchedAt: number;
}

export class SkillRegistryClient {
  private cache: RegistryResponse | null = null;

  constructor(private registryUrl: string, private cachePath?: string) {}

  async listSkills(forceRefresh = false): Promise<RegistrySkill[]> {
    if (!forceRefresh && this.cache) {
      return this.cache.skills;
    }

    if (!this.registryUrl) {
      return [];
    }

    const response = await fetch(this.registryUrl, {
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Registry request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as RegistryResponse;
    const skills = Array.isArray(data.skills) ? data.skills : [];
    this.cache = {
      skills,
      fetchedAt: Date.now(),
    };

    await this.saveCache();

    return skills;
  }

  async findSkill(name: string, version?: string): Promise<RegistrySkill | undefined> {
    const skills = await this.listSkills();
    if (version) {
      return skills.find(skill => skill.name === name && skill.version === version);
    }
    return skills.find(skill => skill.name === name);
  }

  async resolveSkillFiles(skill: RegistrySkill): Promise<RegistrySkillFile[]> {
    if (skill.files && skill.files.length > 0) {
      return skill.files;
    }

    if (skill.downloadUrl) {
      const response = await fetch(skill.downloadUrl, {
        headers: {
          'Accept': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json() as { files?: RegistrySkillFile[] };
      if (!payload.files || payload.files.length === 0) {
        throw new Error('Downloaded skill payload missing files');
      }

      return payload.files;
    }

    throw new Error('Registry skill has no files or download URL');
  }

  async loadCache(): Promise<void> {
    if (!this.cachePath) {
      return;
    }

    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(this.cachePath, 'utf-8');
      const parsed = JSON.parse(content) as RegistryResponse;
      if (parsed && Array.isArray(parsed.skills)) {
        this.cache = parsed;
      }
    } catch (error) {
      // Ignore cache errors
    }
  }

  private async saveCache(): Promise<void> {
    if (!this.cachePath || !this.cache) {
      return;
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      await fs.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (error) {
      // Ignore cache errors
    }
  }
}
