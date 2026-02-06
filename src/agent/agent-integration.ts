import type { ToolManager } from '../tools/tool-manager.js';
import type { Message } from '../context/types.js';
import { AgentLoop } from './agent-loop.js';
import { RunQueue } from './run-queue.js';
import type {
  AgentHooks,
  BeforeAgentStartHook,
  AfterAgentEndHook,
  BeforeToolCallHook,
  AfterToolCallHook,
} from './hooks.js';
import { HookRegistry } from './hook-registry.js';
import { ToolBridge } from './tool-bridge.js';
import type { AgentResult, AgentStreamOptions } from './types.js';

export interface AgentIntegrationOptions {
  toolManager: ToolManager;
  model?: string;
  temperature?: number;
  maxToolCalls?: number;
  maxTurns?: number;
  timeoutMs?: number;
  baseUrl?: string;
  workspacePath?: string;
  sessionId?: string;
  runQueue?: RunQueue;
  hooks?: AgentHooks;
}

/**
 * High-level integration of AgentLoop with ToolManager
 * Provides a simple API for agent execution
 */
export class AgentIntegration {
  private agentLoop: AgentLoop;
  private toolBridge: ToolBridge;
  private runQueue: RunQueue;
  private defaultSessionId: string;
  private hookRegistry: HookRegistry;
  
  constructor(options: AgentIntegrationOptions) {
    this.defaultSessionId = options.sessionId || 'agent-integration';
    this.runQueue = options.runQueue || new RunQueue();
    this.hookRegistry = new HookRegistry();

    if (options.hooks) {
      this.hookRegistry.getHooks().beforeAgentStart.push(...(options.hooks.beforeAgentStart || []));
      this.hookRegistry.getHooks().afterAgentEnd.push(...(options.hooks.afterAgentEnd || []));
      this.hookRegistry.getHooks().beforeToolCall.push(...(options.hooks.beforeToolCall || []));
      this.hookRegistry.getHooks().afterToolCall.push(...(options.hooks.afterToolCall || []));
    }
    this.toolBridge = new ToolBridge(options.toolManager, {
      workspacePath: options.workspacePath,
      requireApprovalForDangerous: false, // Phase 1: auto-approve
      autoApproveTimeout: 2000,
    });
    
    this.agentLoop = new AgentLoop({
      model: options.model || 'Qwen3-4B-Instruct-2507:latest',
      temperature: options.temperature || 0.7,
      maxToolCalls: options.maxToolCalls || 5,
      maxTurns: options.maxTurns || 10,
      timeoutMs: options.timeoutMs || 120000,
      baseUrl: options.baseUrl || 'http://localhost:11434',
      allowDangerousTools: true, // Phase 1: allow all
      requireApproval: false, // Phase 1: no approval needed
      toolBridge: this.toolBridge,
      sessionId: this.defaultSessionId,
      hooks: this.hookRegistry.getHooks(),
    });
  }

  registerHook(type: 'beforeAgentStart', hook: BeforeAgentStartHook): void;
  registerHook(type: 'afterAgentEnd', hook: AfterAgentEndHook): void;
  registerHook(type: 'beforeToolCall', hook: BeforeToolCallHook): void;
  registerHook(type: 'afterToolCall', hook: AfterToolCallHook): void;
  registerHook(type: keyof AgentHooks, hook: BeforeAgentStartHook | AfterAgentEndHook | BeforeToolCallHook | AfterToolCallHook): void {
    if (type === 'beforeAgentStart') {
      this.hookRegistry.registerBeforeAgentStart(hook as BeforeAgentStartHook);
    } else if (type === 'afterAgentEnd') {
      this.hookRegistry.registerAfterAgentEnd(hook as AfterAgentEndHook);
    } else if (type === 'beforeToolCall') {
      this.hookRegistry.registerBeforeToolCall(hook as BeforeToolCallHook);
    } else if (type === 'afterToolCall') {
      this.hookRegistry.registerAfterToolCall(hook as AfterToolCallHook);
    }
  }
  
  /**
   * Run agent with prompt and system prompt
   */
  async run(
    prompt: string,
    systemPrompt: string = '',
    options?: AgentStreamOptions
  ): Promise<AgentResult> {
    const sessionId = options?.sessionId || this.defaultSessionId;
    const runId = options?.runId || this.runQueue.createRunId();

    console.log(`[AgentIntegration] Running agent (runId=${runId}, sessionId=${sessionId}) with prompt: "${prompt.substring(0, 100)}..."`);

    const { meta, result } = await this.runQueue.enqueue(
      sessionId,
      async (runMeta) => {
        const controller = new AbortController();
        const timeoutMs = this.agentLoop.getConfig().timeoutMs || 120000;
        const timeout = setTimeout(() => {
          runMeta.status = 'timeout';
          controller.abort();
        }, timeoutMs);

        if (options?.signal) {
          if (options.signal.aborted) {
            runMeta.status = 'aborted';
            controller.abort();
          } else {
            options.signal.addEventListener('abort', () => {
              runMeta.status = 'aborted';
              controller.abort();
            }, { once: true });
          }
        }

        try {
          const result = await this.agentLoop.run(
            prompt,
            systemPrompt,
            undefined, // Tools will be fetched from ToolBridge
            {
              ...options,
              runId,
              sessionId,
              signal: controller.signal,
            }
          );

          console.log(`[AgentIntegration] Agent completed in ${result.duration}ms`);
          console.log(`[AgentIntegration] Tool executions: ${result.toolExecutions.length}`);
          console.log(`[AgentIntegration] Turns: ${result.turns}`);

          return result;
        } catch (error) {
          console.error(`[AgentIntegration] Agent execution failed:`, error);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
      runId
    );

    const status = meta.status === 'completed' || meta.status === 'error' || meta.status === 'aborted' || meta.status === 'timeout'
      ? meta.status
      : undefined;

    return {
      ...result,
      runId: meta.runId,
      sessionId: meta.sessionId,
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
      status,
    };
  }
  
  /**
   * Simple completion (backward compatibility)
   */
  async complete(
    messages: Message[],
    systemPrompt: string = '',
    forceModel?: string
  ): Promise<{
    response: string;
    toolCalls: Array<{ tool: string; success: boolean; result?: any; error?: string }>;
    modelUsed: string;
  }> {
    // Extract the last user message
    const lastUserMessage = messages
      .slice()
      .reverse()
      .find(m => m.role === 'user');
    
    if (!lastUserMessage) {
      throw new Error('No user message found');
    }
    
    const prompt = typeof lastUserMessage.content === 'string' 
      ? lastUserMessage.content 
      : String(lastUserMessage.content);
    
    // Run agent
    const result = await this.run(prompt, systemPrompt);
    
    // Convert to backward-compatible format
    return {
      response: result.response,
      toolCalls: result.toolExecutions.map(exec => ({
        tool: exec.toolName,
        success: exec.success,
        result: exec.result,
        error: exec.error,
      })),
      modelUsed: forceModel || this.agentLoop.getConfig().model,
    };
  }
  
  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.agentLoop.healthCheck();
  }
  
  /**
   * Get tool statistics
   */
  async getToolStats() {
    return this.toolBridge.getStats();
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: {
    model?: string;
    temperature?: number;
    maxToolCalls?: number;
    maxTurns?: number;
    timeoutMs?: number;
  }): void {
    this.agentLoop.updateConfig(config);
  }
  
  /**
   * Get the underlying agent loop (for advanced use)
   */
  getAgentLoop(): AgentLoop {
    return this.agentLoop;
  }
  
  /**
   * Get the tool bridge (for advanced use)
   */
  getToolBridge(): ToolBridge {
    return this.toolBridge;
  }
}