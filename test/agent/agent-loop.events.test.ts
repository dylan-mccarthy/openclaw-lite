import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgentLoop } from '../../src/agent/agent-loop.js';
import { OpenClawOpenAIClient } from '../../src/ollama/openclaw-openai-client.js';
import type { AgentEvent, ToolDefinition } from '../../src/agent/types.js';
import type { ToolBridge } from '../../src/agent/tool-bridge.js';

const toolBridge = {
  getToolDefinitions: async (): Promise<ToolDefinition[]> => [],
  executeTool: async () => 'ok',
} as unknown as ToolBridge;

describe('AgentLoop event ordering', () => {
  const originalStream = OpenClawOpenAIClient.prototype.streamChatCompletion;

  afterEach(() => {
    OpenClawOpenAIClient.prototype.streamChatCompletion = originalStream;
    vi.restoreAllMocks();
  });

  it('emits agent and message events in order', async () => {
    vi.spyOn(OpenClawOpenAIClient.prototype, 'streamChatCompletion')
      .mockImplementation(async (_messages, _system, _tools, _opts, onDelta) => {
        onDelta?.({ contentDelta: 'Hel' });
        onDelta?.({ contentDelta: 'lo' });
        return { content: 'Hello', toolCalls: [] };
      });

    const loop = new AgentLoop({
      model: 'test-model',
      toolBridge,
    });

    const events: AgentEvent[] = [];
    await loop.run('hi', 'system', undefined, {
      onEvent: (event) => events.push(event),
      runId: 'run_1',
      sessionId: 'session_1',
    });

    const indexOf = (type: AgentEvent['type']) => events.findIndex(e => e.type === type);
    const messageStarts = events
      .map((event, index) => event.type === 'message_start' ? index : -1)
      .filter(index => index >= 0);

    const assistantMessageStart = events.findIndex(
      event => event.type === 'message_start' && event.message?.role === 'assistant'
    );
    const assistantMessageEnd = events.findIndex(
      (event, index) => index > assistantMessageStart && event.type === 'message_end' && event.message?.role === 'assistant'
    );

    expect(indexOf('agent_start')).toBeGreaterThanOrEqual(0);
    expect(indexOf('turn_start')).toBeGreaterThan(indexOf('agent_start'));
    expect(messageStarts.length).toBeGreaterThanOrEqual(2);

    const messageUpdateIndex = indexOf('message_update');

    expect(assistantMessageStart).toBeGreaterThan(-1);
    expect(assistantMessageEnd).toBeGreaterThan(assistantMessageStart);
    expect(messageUpdateIndex).toBeGreaterThan(assistantMessageStart);
    expect(assistantMessageEnd).toBeGreaterThan(messageUpdateIndex);
    expect(indexOf('agent_end')).toBe(events.length - 1);
  });
});
