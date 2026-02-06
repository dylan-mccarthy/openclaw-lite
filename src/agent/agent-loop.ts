import type { 
  AgentContext, 
  AgentEvent, 
  AgentResult,
  ToolDefinition,
  ToolExecutionResult,
  AgentStreamOptions,
  TaskPlan,
  WorkingSummary
} from './types.js';
import type { Message } from '../context/types.js';
import { EventStream } from './event-stream.js';
import { ContextManager } from '../context/context-manager.js';
import { TokenEstimator } from '../context/token-estimator.js';
import type { AgentHooks, AgentHookContext, BeforeAgentStartResult, BeforeToolCallResult } from './hooks.js';
import { OpenClawOpenAIClient } from '../ollama/openclaw-openai-client.js';
import { ModelTemplateRegistry } from '../ollama/model-templates.js';
import type { ToolBridge } from './tool-bridge.js';
import { TaskPlanner } from './task-planner.js';

export interface AgentLoopConfig {
  model: string;
  temperature?: number;
  maxToolCalls?: number;
  maxTurns?: number;
  timeoutMs?: number;
  baseUrl?: string;
  allowDangerousTools?: boolean;
  requireApproval?: boolean;
  formatToolResult?: (result: any) => string;
  messagingToolNames?: string[];
  maxContextTokens?: number;
  reservedTokens?: number;
  compressionStrategy?: 'truncate' | 'selective' | 'hybrid';
  maxCompactionRetries?: number;
  hooks?: AgentHooks;
  toolBridge: ToolBridge;
  sessionId?: string;
}

export class AgentLoop {
  private client: OpenClawOpenAIClient;
  private templateRegistry: ModelTemplateRegistry;
  private contextManager: ContextManager;
  private tokenEstimator: TokenEstimator;
  private config: Required<AgentLoopConfig>;
  private toolBridge?: ToolBridge;
  private messagingToolOutputs: string[] = [];
  private hooks: Required<AgentHooks>;

  private buildSummaryText(summary: WorkingSummary): string {
    const lines: string[] = ['## Working Summary'];

    if (summary.changes.length > 0) {
      lines.push('Changes:', ...summary.changes.map(item => `- ${item}`));
    }
    if (summary.decisions.length > 0) {
      lines.push('Decisions:', ...summary.decisions.map(item => `- ${item}`));
    }
    if (summary.openQuestions.length > 0) {
      lines.push('Open Questions:', ...summary.openQuestions.map(item => `- ${item}`));
    }
    if (summary.nextStep) {
      lines.push(`Next Step: ${summary.nextStep}`);
    }

    return lines.join('\n');
  }
  
  constructor(config: AgentLoopConfig) {
    this.client = new OpenClawOpenAIClient({
      baseUrl: config.baseUrl,
      defaultModel: config.model,
      temperature: config.temperature,
    });
    this.templateRegistry = new ModelTemplateRegistry();
    this.contextManager = new ContextManager({
      maxContextTokens: config.maxContextTokens ?? 8192,
      reservedTokens: config.reservedTokens ?? 1000,
      compressionStrategy: config.compressionStrategy ?? 'hybrid',
      keepFirstLast: true,
    });
    this.tokenEstimator = new TokenEstimator();
    this.toolBridge = config.toolBridge;
    this.hooks = (config.hooks ?? {}) as Required<AgentHooks>;
    this.hooks.beforeAgentStart = this.hooks.beforeAgentStart ?? [];
    this.hooks.afterAgentEnd = this.hooks.afterAgentEnd ?? [];
    this.hooks.beforeToolCall = this.hooks.beforeToolCall ?? [];
    this.hooks.afterToolCall = this.hooks.afterToolCall ?? [];
    
    this.config = {
      model: config.model,
      temperature: config.temperature ?? 0.7,
      maxToolCalls: config.maxToolCalls ?? 5,
      maxTurns: config.maxTurns ?? 10,
      timeoutMs: config.timeoutMs ?? 120000,
      baseUrl: config.baseUrl ?? 'http://localhost:11434',
      allowDangerousTools: config.allowDangerousTools ?? false,
      requireApproval: config.requireApproval ?? true,
      formatToolResult: config.formatToolResult ?? this.defaultFormatToolResult,
      messagingToolNames: config.messagingToolNames ?? [],
      maxContextTokens: config.maxContextTokens ?? 8192,
      reservedTokens: config.reservedTokens ?? 1000,
      compressionStrategy: config.compressionStrategy ?? 'hybrid',
      maxCompactionRetries: config.maxCompactionRetries ?? 1,
      hooks: this.hooks,
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
    const runId = options?.runId;
    const sessionId = options?.sessionId || this.config.sessionId;

    console.log(`[AgentLoop] run start (runId=${runId || 'n/a'}, sessionId=${sessionId})`);

    this.messagingToolOutputs = [];
    
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
    
    const hookContext: AgentHookContext = {
      runId,
      sessionId,
      prompt,
      systemPrompt: context.systemPrompt,
      messages: context.messages,
      tools: context.tools,
      config: context.config,
    };

    await this.runBeforeAgentStartHooks(hookContext, context, options, stream);

    const planner = new TaskPlanner({
      maxContextTokens: this.config.maxContextTokens,
      reservedTokens: this.config.reservedTokens,
    });
    const planDecision = planner.shouldPlan(hookContext.prompt, context.systemPrompt);
    let plan: TaskPlan | undefined;
    let summary: WorkingSummary | undefined;
    let currentStepIndex = 0;

    if (planDecision.shouldPlan) {
      plan = planner.createPlan(hookContext.prompt);
      summary = planner.createWorkingSummary(plan);
      context.plan = plan;
      context.summary = summary;

      this.emitEvent(stream, {
        type: 'plan_created',
        plan,
        summary,
      }, options);
    }

    // Emit start events
    this.emitEvent(stream, { type: 'agent_start', runId, sessionId }, options);
    this.emitEvent(stream, { type: 'turn_start', runId, sessionId }, options);
    this.emitEvent(stream, { 
      type: 'message_start', 
      message: userMessage,
      runId,
      sessionId,
    }, options);
    this.emitEvent(stream, { 
      type: 'message_end', 
      message: userMessage,
      runId,
      sessionId,
    }, options);
    
    try {
      await this.runLoop(context, stream, toolExecutions, {
        ...options,
        runId,
        sessionId,
      }, {
        planner,
        plan,
        summary,
        currentStepIndex,
      });
      turns = this.countTurns(context.messages);
    } catch (error) {
      this.emitEvent(stream, {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
        runId,
        sessionId,
      }, options);
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      
      // Emit final events
      this.emitEvent(stream, { type: 'agent_end', runId, sessionId }, options);
      stream.end();
      
      // Extract final response
      const finalResponse = this.extractFinalResponse(context.messages, toolExecutions);
      
      const result: AgentResult = {
        response: finalResponse,
        toolExecutions,
        messages: context.messages,
        turns,
        duration,
        runId,
        sessionId,
        startedAt: startTime,
        endedAt: Date.now(),
        status: 'completed',
        plan,
        summary: context.summary,
      };

      await this.runAfterAgentEndHooks(hookContext, result, options, stream);

      return result;
    }
  }
  
  /**
   * Main agent loop (simplified version of OpenClaw's runLoop)
   */
  private async runLoop(
    context: AgentContext,
    stream: EventStream,
    toolExecutions: ToolExecutionResult[],
    options?: AgentStreamOptions,
    planning?: {
      planner: TaskPlanner;
      plan?: TaskPlan;
      summary?: WorkingSummary;
      currentStepIndex: number;
    }
  ): Promise<void> {
    let turn = 0;
    let compactionAttempts = 0;
    
    while (turn < this.config.maxTurns) {
      turn++;
      
      if (turn > 1) {
        this.emitEvent(stream, { type: 'turn_start' }, options);
      }
      
      await this.maybeCompactContext(context, stream, options);

      let assistantMessage: Message & { toolCalls?: Array<{ name: string; arguments: any }> };
      try {
        assistantMessage = await this.getAssistantResponse(context, stream, options);
      } catch (error) {
        if (this.isContextOverflowError(error) && compactionAttempts < this.config.maxCompactionRetries) {
          compactionAttempts += 1;
          console.warn(`[AgentLoop] Context overflow detected, retrying compaction (${compactionAttempts}/${this.config.maxCompactionRetries}) (runId=${options?.runId || 'n/a'})`);
          await this.maybeCompactContext(context, stream, options, 'retry');
          assistantMessage = await this.getAssistantResponse(context, stream, options);
        } else {
          throw error;
        }
      }
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

          if (planning?.summary) {
            const summaryPatch = {
              changes: [
                executionResult.success
                  ? `Tool ${executionResult.toolName} completed`
                  : `Tool ${executionResult.toolName} failed: ${executionResult.error || 'unknown error'}`
              ],
            };
            context.summary = planning.planner.updateWorkingSummary(planning.summary, summaryPatch);
            planning.summary = context.summary;
            this.emitEvent(stream, {
              type: 'summary_update',
              summary: context.summary,
            }, options);
          }
        }
        
        // Continue loop to process tool results
        continue;
      } else {
        // No tool calls or max reached, end turn
        this.emitEvent(stream, { 
          type: 'turn_end',
          message: assistantMessage,
        }, options);

        if (planning?.plan && planning.summary) {
          const plan = planning.plan;
          const currentStep = plan.steps[planning.currentStepIndex];

          if (currentStep) {
            currentStep.status = 'done';
            const nextStep = plan.steps[planning.currentStepIndex + 1];
            if (nextStep) {
              nextStep.status = 'in_progress';
              planning.currentStepIndex += 1;
            }
            context.summary = planning.planner.updateWorkingSummary(planning.summary, {
              changes: [`Completed step: ${currentStep.title}`],
              nextStep: nextStep?.title,
            });
            planning.summary = context.summary;

            this.emitEvent(stream, {
              type: 'plan_step',
              step: currentStep,
              plan,
            }, options);
            this.emitEvent(stream, {
              type: 'summary_update',
              summary: context.summary,
            }, options);
          }
        }
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
      const assistantMessage: Message & { toolCalls?: Array<{ name: string; arguments: any }> } = {
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      this.emitEvent(stream, {
        type: 'message_start',
        message: assistantMessage,
      }, options);

      if (options?.onEvent) {
        const streamResult = await this.client.streamChatCompletion(
          context.messages,
          enhancedSystemPrompt,
          context.tools,
          {
            model: this.config.model,
            temperature: this.config.temperature,
            timeout: this.config.timeoutMs,
            signal: options?.signal,
          },
          (delta) => {
            if (delta.contentDelta) {
              assistantMessage.content += delta.contentDelta;
              this.emitEvent(stream, {
                type: 'message_update',
                message: {
                  ...assistantMessage,
                },
              }, options);
            }
          }
        );

        if (streamResult.toolCalls.length > 0) {
          assistantMessage.toolCalls = streamResult.toolCalls;
          console.log(`[AgentLoop] Streaming returned ${streamResult.toolCalls.length} tool calls`);
        }
      } else {
        const response = await this.client.chatCompletion(
          context.messages,
          enhancedSystemPrompt,
          context.tools,
          {
            model: this.config.model,
            temperature: this.config.temperature,
            timeout: this.config.timeoutMs,
            signal: options?.signal,
          }
        );
        
        const choice = response.choices[0];
        if (!choice) {
          throw new Error('No response from AI');
        }
        
        const message = choice.message;
        assistantMessage.content = message.content || '';
        
        // Extract tool calls from OpenAI response
        if (message.tool_calls && message.tool_calls.length > 0) {
          console.log(`[AgentLoop] OpenAI returned ${message.tool_calls.length} tool calls`);
          assistantMessage.toolCalls = message.tool_calls.map(tc => ({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          }));
        }
      }
      
      // Emit message events
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
      
      const hookContext: AgentHookContext = {
        runId: options?.runId,
        sessionId: options?.sessionId,
        prompt: '',
        systemPrompt: '',
        messages: [],
        tools: availableTools,
        config: this.config,
      };

      const updatedToolCall = await this.runBeforeToolCallHooks(
        hookContext,
        toolCall,
        options,
        stream
      );

      // Execute tool via ToolBridge
      let result: any;
      if (this.toolBridge) {
        result = await this.toolBridge.executeTool(
          updatedToolCall.name,
          updatedToolCall.arguments,
          { toolCallId, startTime, sessionId: options?.sessionId || this.config.sessionId }
        );
      } else {
        throw new Error('ToolBridge not configured');
      }
      
      const duration = Date.now() - startTime;

      console.log(`[AgentLoop] Tool ${updatedToolCall.name} completed in ${duration}ms (runId=${options?.runId || 'n/a'})`);

      this.emitEvent(stream, {
        type: 'tool_update',
        toolCallId,
        toolName: updatedToolCall.name,
        args: updatedToolCall.arguments,
        result: this.formatToolResult(result),
        duration,
      }, options);

      this.recordMessagingOutput(updatedToolCall.name, result);
      
      const executionResult: ToolExecutionResult = {
        toolCallId,
        toolName: updatedToolCall.name,
        args: updatedToolCall.arguments,
        result,
        duration,
        success: true,
      };

      await this.runAfterToolCallHooks(hookContext, executionResult, options, stream);

      return executionResult;
    } catch (error) {
      const duration = Date.now() - startTime;

      console.warn(`[AgentLoop] Tool ${toolCall.name} failed in ${duration}ms (runId=${options?.runId || 'n/a'})`);
      
      const executionResult: ToolExecutionResult = {
        toolCallId,
        toolName: toolCall.name,
        args: toolCall.arguments,
        error: error instanceof Error ? error.message : String(error),
        duration,
        success: false,
      };

      await this.runAfterToolCallHooks(
        {
          runId: options?.runId,
          sessionId: options?.sessionId,
          prompt: '',
          systemPrompt: '',
          messages: [],
          tools: availableTools,
          config: this.config,
        },
        executionResult,
        options,
        stream
      );

      return executionResult;
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

    if (/^##\s+Tooling/m.test(systemPrompt)) {
      return systemPrompt;
    }
    
    const toolDescriptions = tools
      .map(tool => `- ${tool.name}: ${tool.description}`)
      .join('\n');
    
    const toolSection = `

## Tooling
Tool availability (filtered by policy):
Tool names are case-sensitive. Call tools exactly as listed.

${toolDescriptions}

## Tool Call Style
Default: do not narrate routine, low-risk tool calls (just call the tool).
Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.
Keep narration brief and value-dense; avoid repeating obvious steps.
Use plain human language for narration unless in a technical context.

## Instructions
- Use tools when appropriate to complete tasks
- When user asks to read a file → use the read tool
- When user asks to list files → use the list tool  
- When user asks about system info → use appropriate tools
- The system will automatically execute tools when you use them
- After a tool executes, you'll see the result and can continue the conversation
`;
    
    return systemPrompt + toolSection;
  }
  
  /**
   * Format tool result for display
   */
  private formatToolResult(result: any): string {
    return this.config.formatToolResult(result);
  }

  private defaultFormatToolResult(result: any): string {
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
  private extractFinalResponse(
    messages: Message[],
    toolExecutions: ToolExecutionResult[]
  ): string {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant') {
      const rawContent = typeof lastMessage.content === 'string'
        ? lastMessage.content
        : String(lastMessage.content);
      const cleaned = rawContent.replace(/\bNO_REPLY\b/g, '').trim();
      if (!cleaned) {
        return '';
      }
      if (this.isDuplicateMessagingReply(cleaned)) {
        return '';
      }
      return cleaned;
    }

    const failures = toolExecutions.filter(exec => !exec.success);
    if (failures.length > 0) {
      if (failures.length === 1) {
        const failure = failures[0];
        return `A tool failed: ${failure.toolName} - ${failure.error || 'unknown error'}`;
      }
      const details = failures
        .map(failure => `- ${failure.toolName}: ${failure.error || 'unknown error'}`)
        .join('\n');
      return `Multiple tools failed:\n${details}`;
    }
    return '';
  }

  private recordMessagingOutput(toolName: string, result: any): void {
    if (!this.config.messagingToolNames.includes(toolName)) {
      return;
    }
    const formatted = this.formatToolResult(result).trim();
    if (!formatted) {
      return;
    }
    this.messagingToolOutputs.push(formatted);
    if (this.messagingToolOutputs.length > 200) {
      this.messagingToolOutputs.splice(0, this.messagingToolOutputs.length - 200);
    }
  }

  private isDuplicateMessagingReply(reply: string): boolean {
    const normalizedReply = this.normalizeText(reply);
    if (!normalizedReply) {
      return false;
    }
    return this.messagingToolOutputs.some(output => this.normalizeText(output) === normalizedReply);
  }

  private normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private async runBeforeAgentStartHooks(
    hookContext: AgentHookContext,
    context: AgentContext,
    options: AgentStreamOptions | undefined,
    stream: EventStream
  ): Promise<void> {
    for (const hook of this.hooks.beforeAgentStart) {
      try {
        const result = await hook(hookContext);
        if (!result) {
          continue;
        }
        if (result.prompt) {
          hookContext.prompt = result.prompt;
        }
        if (result.systemPrompt) {
          hookContext.systemPrompt = result.systemPrompt;
          context.systemPrompt = result.systemPrompt;
        }
        if (result.messages) {
          hookContext.messages = result.messages;
          context.messages = result.messages;
        }
      } catch (error) {
        this.emitEvent(stream, {
          type: 'warning',
          error: error instanceof Error ? error.message : String(error),
        }, options);
      }
    }
  }

  private async runAfterAgentEndHooks(
    hookContext: AgentHookContext,
    result: AgentResult,
    options: AgentStreamOptions | undefined,
    stream: EventStream
  ): Promise<void> {
    for (const hook of this.hooks.afterAgentEnd) {
      try {
        await hook(hookContext, result);
      } catch (error) {
        this.emitEvent(stream, {
          type: 'warning',
          error: error instanceof Error ? error.message : String(error),
        }, options);
      }
    }
  }

  private async runBeforeToolCallHooks(
    hookContext: AgentHookContext,
    toolCall: { name: string; arguments: any },
    options: AgentStreamOptions | undefined,
    stream: EventStream
  ): Promise<{ name: string; arguments: any }> {
    let updated: { name: string; arguments: any } = { ...toolCall };
    for (const hook of this.hooks.beforeToolCall) {
      try {
        const result = await hook(hookContext, updated);
        if (result?.arguments !== undefined) {
          updated = { ...updated, arguments: result.arguments };
        }
      } catch (error) {
        this.emitEvent(stream, {
          type: 'warning',
          error: error instanceof Error ? error.message : String(error),
        }, options);
      }
    }
    return updated;
  }

  private async runAfterToolCallHooks(
    hookContext: AgentHookContext,
    execution: ToolExecutionResult,
    options: AgentStreamOptions | undefined,
    stream: EventStream
  ): Promise<void> {
    for (const hook of this.hooks.afterToolCall) {
      try {
        await hook(hookContext, execution);
      } catch (error) {
        this.emitEvent(stream, {
          type: 'warning',
          error: error instanceof Error ? error.message : String(error),
        }, options);
      }
    }
  }

  private async maybeCompactContext(
    context: AgentContext,
    stream: EventStream,
    options?: AgentStreamOptions,
    reason: 'preflight' | 'retry' = 'preflight'
  ): Promise<void> {
    const systemTokens = this.tokenEstimator.estimate(context.systemPrompt || '');
    const availableTokens = this.config.maxContextTokens - this.config.reservedTokens - systemTokens;
    const currentTokens = context.messages.reduce(
      (sum, msg) => sum + this.tokenEstimator.estimateMessageWithRole(msg),
      0
    );

    if (currentTokens <= availableTokens) {
      return;
    }

    if (context.summary && this.applySummaryContext(context, stream, options, reason)) {
      return;
    }

    const originalCount = context.messages.length;
    const compressionResult = await this.contextManager.compressHistory(
      context.messages,
      context.systemPrompt,
      this.config.model
    );

    context.messages = compressionResult.messages;

    console.log(`[AgentLoop] Compaction ${reason} ${originalCount} -> ${compressionResult.messages.length} messages (runId=${options?.runId || 'n/a'})`);

    this.emitEvent(stream, {
      type: 'compaction',
      originalMessages: originalCount,
      compressedMessages: compressionResult.messages.length,
      compressionRatio: compressionResult.compressionRatio,
      compactionReason: reason,
    }, options);
  }

  private applySummaryContext(
    context: AgentContext,
    stream: EventStream,
    options: AgentStreamOptions | undefined,
    reason: string
  ): boolean {
    const summary = context.summary;
    if (!summary) {
      return false;
    }

    const summaryText = this.buildSummaryText(summary);
    if (!summaryText.trim()) {
      return false;
    }

    const tail = context.messages.slice(-2);
    const summaryMessage: Message = {
      role: 'user',
      content: summaryText,
      timestamp: new Date(),
    };

    context.messages = [summaryMessage, ...tail];

    this.emitEvent(stream, {
      type: 'context_replace',
      summary,
      replaceReason: `summary_${reason}`,
    }, options);

    return true;
  }

  private isContextOverflowError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /context|token|length|too long/i.test(message);
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
    const stampedEvent = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
      runId: event.runId || options?.runId,
      sessionId: event.sessionId || options?.sessionId,
    };
    stream.push(stampedEvent);
    options?.onEvent?.(stampedEvent);
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