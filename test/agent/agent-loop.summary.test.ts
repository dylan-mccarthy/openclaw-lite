import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgentLoop } from '../../src/agent/agent-loop.js';
import { OpenClawOpenAIClient } from '../../src/ollama/openclaw-openai-client.js';
import type { AgentEvent, ToolDefinition } from '../../src/agent/types.js';
import type { ToolBridge } from '../../src/agent/tool-bridge.js';

const toolBridge = {
  getToolDefinitions: async (): Promise<ToolDefinition[]> => [],
  executeTool: async () => 'ok',
} as unknown as ToolBridge;

describe('AgentLoop summary context replacement', () => {
  const originalStream = OpenClawOpenAIClient.prototype.streamChatCompletion;

  afterEach(() => {
    OpenClawOpenAIClient.prototype.streamChatCompletion = originalStream;
    vi.restoreAllMocks();
  });

  it('emits context_replace when over budget and summary exists', async () => {
    vi.spyOn(OpenClawOpenAIClient.prototype, 'streamChatCompletion')
      .mockImplementation(async (_messages, _system, _tools, _opts, onDelta) => {
        onDelta?.({ contentDelta: 'ok' });
        return { content: 'ok', toolCalls: [] };
      });

    const loop = new AgentLoop({
      model: 'test-model',
      toolBridge,
      maxContextTokens: 200,
      reservedTokens: 50,
    });

    const events: AgentEvent[] = [];
    await loop.run(
      'Please break down this task into steps and execute it.',
      'system '.repeat(200),
      undefined,
      {
        onEvent: (event) => events.push(event),
        runId: 'run_summary',
        sessionId: 'session_summary',
      }
    );

    expect(events.some(event => event.type === 'plan_created')).toBe(true);
    expect(events.some(event => event.type === 'context_replace')).toBe(true);
  });
});
