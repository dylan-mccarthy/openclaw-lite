import type { 
  AgentContext, 
  AgentEvent, 
  AgentResult,
  ToolDefinition,
  ToolExecutionResult,
  AgentStreamOptions
} from './types.js';
import type { Message } from '../context/types.js';
import { EventStream } from './event-stream.js';
import { OpenClawOpenAIClient } from '../ollama/openclaw-openai-client.js';
import { ModelTemplateRegistry } from '../ollama/model-templates.js';
import type { ToolBridge } from './tool-bridge.js';

export interface AgentLoopConfig {
  model: string;
  temperature?: number;
  maxToolCalls?: number;
  maxTurns?: number;
  timeoutMs?: number;
  baseUrl?: string;
  allowDangerousTools?: boolean;
  requireApproval?: boolean;
  toolBridge: ToolBridge;
  sessionId?: string;
}

export class AgentLoop {
  private client: OpenClawOpenAIClient;
  private templateRegistry: ModelTemplateRegistry;
  private config: Required<AgentLoopConfig>;
  private toolBridge?: ToolBridge;
  
  constructor(config: AgentLoopConfig) {
    this.client = new OpenClawOpenAIClient({
      baseUrl: config.baseUrl,
      defaultModel: config.model,
      temperature: config.temperature,
    });
    this.templateRegistry = new ModelTemplateRegistry();
    this.toolBridge = config.toolBridge;
    
    this.config = {
      model: config.model,
      temperature: config.temperature ?? 0.7,
      maxToolCalls: config.maxToolCalls ?? 5,
      maxTurns: config.maxTurns ?? 10,
      timeoutMs: config.timeoutMs ?? 120000,
      baseUrl: config.baseUrl ?? 'http://localhost:11434',
      allowDangerousTools: config.allowDangerousTools ?? false,
      requireApproval: config.requireApproval ?? true,
      toolBridge: config.toolBridge,
      sessionId: config.sessionId ?? 'agent-session',
    };
  }
  
  /**
   * Start an agent loop with a new prompt
   */
  async run(
    prompt: string,
    systemPrompt: string,
    tools?: ToolDefinition[],
    options?: AgentStreamOptions
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const stream = EventStream.createAgentStream();
    const toolExecutions: ToolExecutionResult[] = [];
    const messages: Message[] = [];
    let turns = 0;
    
    // Get tools from ToolBridge if not provided
    let finalTools = tools;
    if (!finalTools && this.toolBridge) {
      finalTools = await this.toolBridge.getToolDefinitions();
    } else if (!finalTools) {
      finalTools = [];
    }
    
    // Create initial context
    const context: AgentContext = {
      messages: [],
      systemPrompt,
      tools: finalTools,
      config: {
        model: this.config.model,
        temperature: this.config.temperature,
        maxToolCalls: this.config.maxToolCalls,
      },
    };
    
    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };
    context.messages.push(userMessage);
    messages.push(userMessage);
    
    // Emit start events
    this.emitEvent(stream, { type: 'agent_start' }, options);
    this.emitEvent(stream, { type: 'turn_start' }, options);
    this.emitEvent(stream, { 
      type: 'message_start', 
      message: userMessage 
    }, options);
    this.emitEvent(stream, { 
      type: 'message_end', 
      message: userMessage 
    }, options);
    
    try {
      await this.runLoop(context, stream, toolExecutions, options);
      turns = this.countTurns(context.messages);
    } catch (error) {
      this.emitEvent(stream, {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      }, options);
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      
      // Emit final events
      this.emitEvent(stream, { type: 'agent_end' }, options);
      stream.end();
      
      // Extract final response
      const finalResponse = this.extractFinalResponse(context.messages);
      
      return {
        response: finalResponse,
        toolExecutions,
        messages: context.messages,
        turns,
        duration,
      };
    }
  }
  
  /**
   * Main agent loop (simplified version of OpenClaw's runLoop)
   */
  private async runLoop(
    context: AgentContext,
    stream: EventStream,
    toolExecutions: ToolExecutionResult[],
    options?: AgentStreamOptions
  ): Promise<void> {
    let turn = 0;
    
    while (turn < this.config.maxTurns) {
      turn++;
      
      if (turn > 1) {
        this.emitEvent(stream, { type: 'turn_start' }, options);
      }
      
      // Get assistant response
      const assistantMessage = await this.getAssistantResponse(context, stream, options);
      context.messages.push(assistantMessage);
      
      // Check for tool calls
      const toolCalls = assistantMessage.toolCalls || this.extractToolCalls(assistantMessage);
      
      if (toolCalls.length > 0 && turn <= this.config.maxToolCalls) {
        // Execute tools
        for (const toolCall of toolCalls) {
          const executionResult = await this.executeToolCall(
            toolCall,
            context.tools,
            stream,
            options
          );
          
          toolExecutions.push(executionResult);
          
          // Add tool result to context
          const toolResultMessage: Message = {
            role: 'user', // Tool results come from "user" (system)
            content: executionResult.success
              ? `Tool ${toolCall.name} result: ${this.formatToolResult(executionResult.result)}`
              : `Tool ${toolCall.name} error: ${executionResult.error}`,
            timestamp: new Date(),
          };
          
          context.messages.push(toolResultMessage);
          
          this.emitEvent(stream, {
            type: executionResult.success ? 'tool_result' : 'tool_error',
            toolCallId: executionResult.toolCallId,
            toolName: executionResult.toolName,
            args: executionResult.args,
            result: executionResult.result,
            error: executionResult.error,
            duration: executionResult.duration,
          }, options);
        }
        
        // Continue loop to process tool results
        continue;
      } else {
        // No tool calls or max reached, end turn
        this.emitEvent(stream, { 
          type: 'turn_end',
          message: assistantMessage,
        }, options);
        break;
      }
    }
  }
  
  /**
   * Get assistant response from LLM
   */
  private async getAssistantResponse(
    context: AgentContext,
    stream: EventStream,
    options?: AgentStreamOptions
  ): Promise<Message & { toolCalls?: Array<{ name: string; arguments: any }> }> {
    const enhancedSystemPrompt = this.enhanceSystemPrompt(
      context.systemPrompt,
      context.tools,
      this.config.model
    );
    
    try {
      const response = await this.client.chatCompletion(
        context.messages,
        enhancedSystemPrompt,
        context.tools,
        {
          model: this.config.model,
          temperature: this.config.temperature,
          timeout: this.config.timeoutMs,
        }
      );
      
      const choice = response.choices[0];
      if (!choice) {
        throw new Error('No response from AI');
      }
      
      const message = choice.message;
      const assistantMessage: Message & { toolCalls?: Array<{ name: string; arguments: any }> } = {
        role: 'assistant',
        content: message.content || '',
        timestamp: new Date(),
      };
      
      // Extract tool calls from OpenAI response
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(`[AgentLoop] OpenAI returned ${message.tool_calls.length} tool calls`);
        assistantMessage.toolCalls = message.tool_calls.map(tc => ({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        }));
      }
      
      // Emit message events
      this.emitEvent(stream, {
        type: 'message_start',
        message: assistantMessage,
      }, options);
      
      this.emitEvent(stream, {
        type: 'message_end',
        message: assistantMessage,
      }, options);
      
      return assistantMessage;
    } catch (error) {
      this.emitEvent(stream, {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      }, options);
      throw error;
    }
  }
  
  /**
   * Execute a tool call
   */
  private async executeToolCall(
    toolCall: { name: string; arguments: any },
    availableTools: ToolDefinition[],
    stream: EventStream,
    options?: AgentStreamOptions
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const toolCallId = `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.emitEvent(stream, {
      type: 'tool_execution_start',
      toolCallId,
      toolName: toolCall.name,
      args: toolCall.arguments,
    }, options);
    
    try {
      // Find the tool
      const tool = availableTools.find(t => t.name === toolCall.name);
      if (!tool) {
        throw new Error(`Tool not found: ${toolCall.name}`);
      }
      
      // Execute tool via ToolBridge
      let result: any;
      if (this.toolBridge) {
        result = await this.toolBridge.executeTool(
          toolCall.name,
          toolCall.arguments,
          { toolCallId, startTime, sessionId: this.config.sessionId }
        );
      } else {
        throw new Error('ToolBridge not configured');
      }
      
      const duration = Date.now() - startTime;
      
      return {
        toolCallId,
        toolName: toolCall.name,
        args: toolCall.arguments,
        result,
        duration,
        success: true,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      return {
        toolCallId,
        toolName: toolCall.name,
        args: toolCall.arguments,
        error: error instanceof Error ? error.message : String(error),
        duration,
        success: false,
      };
    }
  }
  
  /**
   * Extract tool calls from assistant message
   * 
   * Phase 1: Simple implementation
   * Phase 2: Parse OpenAI native tool_calls format
   */
  private extractToolCalls(message: Message): Array<{ name: string; arguments: any }> {
    const toolCalls: Array<{ name: string; arguments: any }> = [];
    
    // Check if message content contains tool call markers
    const content = message.content;
    if (typeof content === 'string') {
      // Try to extract <tool_call> tags (our custom format)
      const toolCallRegex = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g;
      let match;
      
      while ((match = toolCallRegex.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed.tool && parsed.arguments) {
            toolCalls.push({
              name: parsed.tool,
              arguments: parsed.arguments,
            });
          }
        } catch (error) {
          console.warn(`[AgentLoop] Failed to parse tool call:`, error);
        }
      }
      
      // Also check for OpenAI format (from earlier implementation)
      const openAIToolCallRegex = /```tool_code\s*\n([a-zA-Z_]+)\s*\n([\s\S]*?)```/g;
      while ((match = openAIToolCallRegex.exec(content)) !== null) {
        const toolName = match[1];
        const argsText = match[2];
        
        try {
          // Try to parse arguments as JSON
          const args = JSON.parse(argsText.trim());
          toolCalls.push({
            name: toolName,
            arguments: args,
          });
        } catch (error) {
          // If not JSON, use as-is
          toolCalls.push({
            name: toolName,
            arguments: { input: argsText.trim() },
          });
        }
      }
    }
    
    console.log(`[AgentLoop] Extracted ${toolCalls.length} tool calls from message`);
    return toolCalls;
  }
  
  /**
   * Enhance system prompt with tool descriptions
   */
  private enhanceSystemPrompt(
    systemPrompt: string,
    tools: ToolDefinition[],
    modelId: string
  ): string {
    if (tools.length === 0) {
      return systemPrompt;
    }
    
    const toolDescriptions = tools
      .map(tool => `- ${tool.name}: ${tool.description}`)
      .join('\n');
    
    const toolSection = `

## Available Tools

${toolDescriptions}

## Instructions
- Use tools when appropriate to complete tasks
- The system will automatically execute tools when you use them
- After a tool executes, you'll see the result and can continue the conversation
`;
    
    return systemPrompt + toolSection;
  }
  
  /**
   * Format tool result for display
   */
  private formatToolResult(result: any): string {
    if (typeof result === 'string') {
      return result;
    }
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  
  /**
   * Extract final response from messages
   */
  private extractFinalResponse(messages: Message[]): string {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant') {
      return typeof lastMessage.content === 'string' 
        ? lastMessage.content 
        : String(lastMessage.content);
    }
    return '';
  }
  
  /**
   * Count turns in conversation
   */
  private countTurns(messages: Message[]): number {
    let turns = 0;
    let lastRole: string | null = null;
    
    for (const message of messages) {
      if (message.role === 'assistant' && lastRole === 'user') {
        turns++;
      }
      lastRole = message.role;
    }
    
    return turns;
  }
  
  /**
   * Emit event to stream and optional callback
   */
  private emitEvent(
    stream: EventStream,
    event: AgentEvent,
    options?: AgentStreamOptions
  ): void {
    stream.push(event);
    options?.onEvent?.(event);
  }
  
  /**
   * Get current configuration
   */
  getConfig(): AgentLoopConfig {
    return { ...this.config };
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Partial<AgentLoopConfig>): void {
    this.config = { ...this.config, ...config };
    this.client.updateOptions({
      baseUrl: config.baseUrl,
      defaultModel: config.model,
      temperature: config.temperature,
    });
  }
  
  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.client.healthCheck();
  }
}