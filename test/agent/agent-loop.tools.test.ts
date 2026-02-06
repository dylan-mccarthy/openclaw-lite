import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgentLoop } from '../../src/agent/agent-loop.js';
import { OpenClawOpenAIClient } from '../../src/ollama/openclaw-openai-client.js';
import type { AgentEvent, ToolDefinition } from '../../src/agent/types.js';
import type { ToolBridge } from '../../src/agent/tool-bridge.js';

describe('AgentLoop tool handling', () => {
  const originalStream = OpenClawOpenAIClient.prototype.streamChatCompletion;

  afterEach(() => {
    OpenClawOpenAIClient.prototype.streamChatCompletion = originalStream;
    vi.restoreAllMocks();
  });

  it('executes tool calls and emits tool events', async () => {
    let callCount = 0;
    vi.spyOn(OpenClawOpenAIClient.prototype, 'streamChatCompletion')
      .mockImplementation(async (_messages, _system, _tools, _opts, onDelta) => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: '',
            toolCalls: [
              { name: 'echo', arguments: { text: 'hi' } }
            ]
          };
        }
        onDelta?.({ contentDelta: 'done' });
        return { content: 'done', toolCalls: [] };
      });

    const toolDefinitions: ToolDefinition[] = [
      {
        name: 'echo',
        description: 'Echo input',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' }
          },
          required: ['text']
        }
      }
    ];

    const executeTool = vi.fn().mockResolvedValue('hi');
    const toolBridge = {
      getToolDefinitions: async () => toolDefinitions,
      executeTool,
    } as unknown as ToolBridge;

    const loop = new AgentLoop({
      model: 'test-model',
      toolBridge,
    });

    const events: AgentEvent[] = [];
    const result = await loop.run('use tool', 'system', undefined, {
      onEvent: (event) => events.push(event),
      runId: 'run_2',
      sessionId: 'session_2',
    });

    expect(executeTool).toHaveBeenCalledWith(
      'echo',
      { text: 'hi' },
      expect.objectContaining({ toolCallId: expect.any(String) })
    );

    expect(events.some(event => event.type === 'tool_execution_start')).toBe(true);
    expect(events.some(event => event.type === 'tool_update')).toBe(true);
    expect(events.some(event => event.type === 'tool_result')).toBe(true);
    expect(result.response).toBe('done');
  });
});
