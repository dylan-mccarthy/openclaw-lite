import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

interface ActivationState {
  active: Record<string, string>;
}

export class SkillActivationStore {
  private storeFile: string;
  private state: ActivationState = { active: {} };

  constructor(storagePath: string) {
    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true });
    }

    this.storeFile = path.join(storagePath, 'skills-activation.json');
    this.load();
  }

  listActive(): Array<{ name: string; version: string }> {
    return Object.entries(this.state.active).map(([name, version]) => ({ name, version }));
  }

  isActive(name: string): boolean {
    return Boolean(this.state.active[name]);
  }

  activate(name: string, version: string): void {
    this.state.active[name] = version;
    this.save();
  }

  deactivate(name: string): void {
    delete this.state.active[name];
    this.save();
  }

  private load(): void {
    if (!existsSync(this.storeFile)) {
      this.save();
      return;
    }

    try {
      const content = readFileSync(this.storeFile, 'utf8');
      const parsed = JSON.parse(content) as ActivationState;
      if (parsed && parsed.active) {
        this.state = parsed;
      }
    } catch (error) {
      this.state = { active: {} };
      this.save();
    }
  }

  private save(): void {
    try {
      writeFileSync(this.storeFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      // Ignore save errors
    }
  }
}
