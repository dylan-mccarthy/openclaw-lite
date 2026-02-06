import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { rmSync, mkdirSync } from 'fs';
import { AgentLoop } from '../../src/agent/agent-loop.js';
import { MemoryStreamingAgent } from '../../src/agent/memory-streaming-agent.js';
import { MemoryIntegration } from '../../src/agent/memory-integration.js';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { OpenClawOpenAIClient } from '../../src/ollama/openclaw-openai-client.js';
import type { AgentEvent, ToolDefinition } from '../../src/agent/types.js';
import type { ToolBridge } from '../../src/agent/tool-bridge.js';

const originalStream = OpenClawOpenAIClient.prototype.streamChatCompletion;

describe('Memory streaming integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), 'test-temp-memory');
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    OpenClawOpenAIClient.prototype.streamChatCompletion = originalStream;
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('streams events, executes tools, and saves memory', async () => {
    let callCount = 0;
    vi.spyOn(OpenClawOpenAIClient.prototype, 'streamChatCompletion')
      .mockImplementation(async (_messages, _system, _tools, _opts, onDelta) => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: '',
            toolCalls: [
              { name: 'echo', arguments: { text: 'apollo' } }
            ]
          };
        }
        onDelta?.({ contentDelta: 'final answer' });
        return { content: 'final answer', toolCalls: [] };
      });

    const memoryManager = new MemoryManager({ storagePath: tempDir });
    memoryManager.saveSession('session_seed', [
      { role: 'user', content: 'Apollo mission details', timestamp: new Date() },
      { role: 'assistant', content: 'Apollo was a NASA program', timestamp: new Date() },
    ], { tags: ['apollo'] });

    const memoryIntegration = new MemoryIntegration(memoryManager);

    const toolDefinitions: ToolDefinition[] = [
      {
        name: 'echo',
        description: 'Echo input',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text']
        }
      }
    ];

    const toolBridge = {
      getToolDefinitions: async () => toolDefinitions,
      executeTool: async (_name: string, args: { text: string }) => `echo:${args.text}`,
    } as unknown as ToolBridge;

    const loop = new AgentLoop({
      model: 'test-model',
      toolBridge,
    });

    const memoryAgent = new MemoryStreamingAgent(loop, toolBridge, memoryIntegration);

    const events: AgentEvent[] = [];
    const result = await memoryAgent.runWithMemory('Tell me about Apollo', 'system', {
      onEvent: (event) => events.push(event),
      runId: 'run_mem',
      sessionId: 'session_mem',
    });

    expect(result.memoryUsed).toBe(true);
    expect(result.memorySessionsFound).toBeGreaterThan(0);
    expect(result.response).toBe('final answer');

    expect(events.some(event => event.type === 'memory_search')).toBe(true);
    expect(events.some(event => event.type === 'tool_result')).toBe(true);
    expect(events.some(event => event.type === 'memory_save')).toBe(true);
  });
});
