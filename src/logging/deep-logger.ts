import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { APP_NAME, APP_VERSION } from '../version.js';

export interface DeepLogEntry {
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
}

export interface DeepLogExport {
  generatedAt: string;
  app: {
    name: string;
    version: string;
  };
  entries: DeepLogEntry[];
}

export class DeepLogger {
  private logFile: string;

  constructor(private logsPath: string, fileName = 'deep-log.jsonl') {
    if (!existsSync(logsPath)) {
      mkdirSync(logsPath, { recursive: true });
    }
    this.logFile = path.join(logsPath, fileName);
  }

  logEvent(type: string, data: Record<string, unknown>): void {
    const entry: DeepLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      data,
    };

    const line = JSON.stringify(entry);
    this.appendLine(line);
  }

  readRecent(limit = 200): DeepLogEntry[] {
    const lines = this.readLines();
    if (lines.length === 0) {
      return [];
    }

    const slice = lines.slice(-limit);
    return slice
      .map((line) => this.parseLine(line))
      .filter((entry): entry is DeepLogEntry => entry !== null);
  }

  exportBundle(limit = 2000): DeepLogExport {
    const entries = this.readRecent(limit);
    return {
      generatedAt: new Date().toISOString(),
      app: {
        name: APP_NAME,
        version: APP_VERSION,
      },
      entries,
    };
  }

  private appendLine(line: string): void {
    const content = `${line}\n`;
    if (existsSync(this.logFile)) {
      writeFileSync(this.logFile, content, { encoding: 'utf8', flag: 'a' });
    } else {
      writeFileSync(this.logFile, content, { encoding: 'utf8' });
    }
  }

  private readLines(): string[] {
    if (!existsSync(this.logFile)) {
      return [];
    }

    const content = readFileSync(this.logFile, 'utf8');
    return content.split('\n').filter((line) => line.trim().length > 0);
  }

  private parseLine(line: string): DeepLogEntry | null {
    try {
      return JSON.parse(line) as DeepLogEntry;
    } catch (error) {
      return null;
    }
  }
}
