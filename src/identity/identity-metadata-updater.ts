/**
 * Identity Metadata Updater for OpenClaw Lite
 * Updates IDENTITY.md using conversation context and SOUL.md
 */

import fs from 'fs';
import path from 'path';
import type { OllamaIntegration } from '../ollama/integration.js';
import type { Message } from '../context/types.js';

export interface IdentityMetadata {
  name?: string;
  vibe?: string;
  emoji?: string;
  role?: string;
  summary?: string;
}

export class IdentityMetadataUpdater {
  private identityPath: string;
  private soulPath: string;
  private conversationLogPath: string;
  private analysisInterval: number = 10;

  constructor(
    private workspaceDir: string,
    private ollamaIntegration: OllamaIntegration
  ) {
    const identityDir = path.join(workspaceDir, 'identity');
    this.identityPath = path.join(identityDir, 'IDENTITY.md');
    this.soulPath = path.join(identityDir, 'SOUL.md');
    this.conversationLogPath = path.join(identityDir, 'conversations.log');

    if (!fs.existsSync(identityDir)) {
      fs.mkdirSync(identityDir, { recursive: true });
    }
  }

  async analyzeAndUpdate(): Promise<boolean> {
    const entries = this.loadConversationEntries();
    if (entries.length < 5) {
      console.log('📝 Not enough conversations for identity metadata analysis');
      return false;
    }

    const soulContent = fs.existsSync(this.soulPath)
      ? fs.readFileSync(this.soulPath, 'utf-8')
      : '';
    const currentIdentity = fs.existsSync(this.identityPath)
      ? fs.readFileSync(this.identityPath, 'utf-8')
      : this.createDefaultIdentityTemplate();

    const conversationContext = entries
      .slice(-this.analysisInterval)
      .map(entry => {
        const timestamp = new Date(entry.timestamp).toLocaleString();
        return `[${timestamp}] User: ${entry.userMessage}\nAssistant: ${entry.assistantMessage}`;
      })
      .join('\n\n');

    const systemPrompt = `You update IDENTITY.md for the assistant.

## Current IDENTITY.md
${currentIdentity}

## SOUL.md
${soulContent || '(missing)'}

## Task
- Infer or refine assistant identity metadata based on SOUL.md and recent conversations.
- Provide a concise name, vibe, emoji, role, and 1-2 sentence summary.
- Be conservative; only update if the signal is clear.

## Output
Return JSON only with keys: name, vibe, emoji, role, summary.
Example:
{
  "name": "OpenClaw",
  "vibe": "direct and playful",
  "emoji": "🧠",
  "role": "personal assistant",
  "summary": "A helpful, concise assistant focused on developer workflows."
}`;

    const userMessage = `Recent conversations:\n${conversationContext}`;

    try {
      const messages: Message[] = [
        { role: 'user', content: userMessage, timestamp: new Date() }
      ];

      const result = await this.ollamaIntegration.complete(
        messages,
        systemPrompt,
        undefined,
        undefined
      );

      const metadata = this.parseMetadata(result.response);
      if (!metadata) {
        console.warn('⚠️  Identity metadata update skipped (invalid response)');
        return false;
      }

      const updatedContent = this.applyMetadata(currentIdentity, metadata);
      if (!updatedContent.changed) {
        console.log('🧠 Identity metadata unchanged');
        return false;
      }

      this.writeIdentity(updatedContent.content, currentIdentity);
      console.log('🧠 Updated IDENTITY.md');
      return true;
    } catch (error) {
      console.warn('Identity metadata analysis failed:', error);
      return false;
    }
  }

  getCurrentIdentitySummary(): string {
    if (!fs.existsSync(this.identityPath)) {
      return 'No IDENTITY.md file found';
    }

    try {
      return fs.readFileSync(this.identityPath, 'utf-8').split('\n').slice(0, 12).join('\n');
    } catch {
      return 'Error reading IDENTITY.md';
    }
  }

  private loadConversationEntries(): Array<{ timestamp: string; userMessage: string; assistantMessage: string }> {
    if (!fs.existsSync(this.conversationLogPath)) {
      return [];
    }

    const logContent = fs.readFileSync(this.conversationLogPath, 'utf-8');
    return logContent
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(entry => entry !== null)
      .slice(-this.analysisInterval * 2);
  }

  private parseMetadata(response: string): IdentityMetadata | null {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        name: stringOrUndefined(parsed.name),
        vibe: stringOrUndefined(parsed.vibe),
        emoji: stringOrUndefined(parsed.emoji),
        role: stringOrUndefined(parsed.role),
        summary: stringOrUndefined(parsed.summary),
      };
    } catch {
      return null;
    }
  }

  private applyMetadata(current: string, metadata: IdentityMetadata): { changed: boolean; content: string } {
    const lines = current.split('\n');
    let changed = false;

    const updateLine = (label: string, value?: string) => {
      if (!value) {
        return;
      }
      const target = `- **${label}:**`;
      const index = lines.findIndex(line => line.trim().startsWith(target));
      if (index >= 0) {
        const currentValue = lines[index].replace(target, '').trim();
        if (currentValue !== value) {
          lines[index] = `${target} ${value}`;
          changed = true;
        }
      }
    };

    updateLine('Name', metadata.name);
    updateLine('Vibe', metadata.vibe);
    updateLine('Emoji', metadata.emoji);
    updateLine('Role', metadata.role);

    if (metadata.summary) {
      const summaryHeader = '## Summary';
      const headerIndex = lines.findIndex(line => line.trim() === summaryHeader);
      if (headerIndex >= 0) {
        const nextHeaderIndex = lines.findIndex((line, idx) => idx > headerIndex && line.startsWith('## '));
        const end = nextHeaderIndex >= 0 ? nextHeaderIndex : lines.length;
        const before = lines.slice(0, headerIndex + 1);
        const after = lines.slice(end);
        lines.length = 0;
        lines.push(...before, metadata.summary, '', ...after);
        changed = true;
      }
    }

    const updatedHeader = 'Last Updated:';
    const updatedLineIndex = lines.findIndex(line => line.trim().startsWith(updatedHeader));
    const updatedValue = `Last Updated: ${new Date().toISOString()}`;
    if (updatedLineIndex >= 0) {
      lines[updatedLineIndex] = updatedValue;
      changed = true;
    } else {
      lines.push('', updatedValue);
      changed = true;
    }

    return { changed, content: lines.join('\n') };
  }

  private writeIdentity(updated: string, previous: string): void {
    if (!fs.existsSync(this.identityPath)) {
      fs.writeFileSync(this.identityPath, this.createDefaultIdentityTemplate(), 'utf-8');
    }
    const backupPath = `${this.identityPath}.backup-${Date.now()}`;
    fs.writeFileSync(backupPath, previous, 'utf-8');
    fs.writeFileSync(this.identityPath, updated, 'utf-8');
  }

  private createDefaultIdentityTemplate(): string {
    return `# IDENTITY.md - Assistant Identity

- **Name:**
- **Vibe:**
- **Emoji:**
- **Role:**

## Summary
Describe the assistant in 1-2 sentences.

Last Updated: ${new Date().toISOString()}
`;
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
