import type { ToolManager } from '../tools/tool-manager.js';
import type { Message } from '../context/types.js';
import { AgentLoop } from './agent-loop.js';
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
}

/**
 * High-level integration of AgentLoop with ToolManager
 * Provides a simple API for agent execution
 */
export class AgentIntegration {
  private agentLoop: AgentLoop;
  private toolBridge: ToolBridge;
  
  constructor(options: AgentIntegrationOptions) {
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
      sessionId: options.sessionId || 'agent-integration',
    });
  }
  
  /**
   * Run agent with prompt and system prompt
   */
  async run(
    prompt: string,
    systemPrompt: string = '',
    options?: AgentStreamOptions
  ): Promise<AgentResult> {
    console.log(`[AgentIntegration] Running agent with prompt: "${prompt.substring(0, 100)}..."`);
    
    try {
      const result = await this.agentLoop.run(
        prompt,
        systemPrompt,
        undefined, // Tools will be fetched from ToolBridge
        options
      );
      
      console.log(`[AgentIntegration] Agent completed in ${result.duration}ms`);
      console.log(`[AgentIntegration] Tool executions: ${result.toolExecutions.length}`);
      console.log(`[AgentIntegration] Turns: ${result.turns}`);
      
      return result;
    } catch (error) {
      console.error(`[AgentIntegration] Agent execution failed:`, error);
      throw error;
    }
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