import type { ToolManager } from './tool-manager.js';
import type { Message } from '../context/types.js';
import { OpenClawOpenAIClient } from '../ollama/openclaw-openai-client.js';
import { ModelTemplateRegistry } from '../ollama/model-templates.js';

export interface ToolCallResult {
  tool: string;
  success: boolean;
  result?: any;
  error?: string;
}

export interface OpenClawToolIntegrationOptions {
  baseUrl?: string;
  defaultModel?: string;
  temperature?: number;
  maxToolCalls?: number;
  allowDangerousTools?: boolean;
  requireApproval?: boolean;
}

export class OpenClawToolIntegration {
  private client: OpenClawOpenAIClient;
  private templateRegistry: ModelTemplateRegistry;
  private maxToolCalls: number;
  
  constructor(
    private toolManager: ToolManager,
    options: OpenClawToolIntegrationOptions = {}
  ) {
    this.client = new OpenClawOpenAIClient({
      baseUrl: options.baseUrl,
      defaultModel: options.defaultModel,
      temperature: options.temperature,
    });
    this.templateRegistry = new ModelTemplateRegistry();
    this.maxToolCalls = options.maxToolCalls || 5;
  }
  
  async complete(
    messages: Message[],
    systemPrompt: string = '',
    forceModel?: string
  ): Promise<{
    response: string;
    toolCalls: ToolCallResult[];
    modelUsed: string;
  }> {
    const toolCalls: ToolCallResult[] = [];
    const modelUsed = forceModel || this.client.defaultModel;
    
    console.log(`[OpenClaw Tool Integration] Starting with ${messages.length} messages, model: ${modelUsed}`);
    
    // Get available tools
    const availableTools = this.toolManager.listTools();
    console.log(`[OpenClaw Tool Integration] Available tools: ${availableTools.length}`);
    
    // Check if model supports OpenAI tool calling
    const supportsTools = this.templateRegistry.supportsOpenAITools(modelUsed);
    
    if (!supportsTools) {
      console.warn(`[OpenClaw Tool Integration] Model ${modelUsed} doesn't support OpenAI tool calling, falling back to text`);
      // Fall back to simple completion without tools
      const response = await this.client.simpleCompletion(
        messages,
        systemPrompt,
        { model: modelUsed }
      );
      return {
        response,
        toolCalls: [],
        modelUsed,
      };
    }
    
    // Enhance system prompt with tool descriptions (like OpenClaw does)
    const enhancedSystemPrompt = this.enhanceSystemPrompt(systemPrompt, availableTools, modelUsed);
    
    let currentMessages = [...messages];
    let iteration = 0;
    let finalResponse = '';
    
    while (iteration < this.maxToolCalls) {
      iteration++;
      console.log(`[OpenClaw Tool Integration] Iteration ${iteration}/${this.maxToolCalls}`);
      
      // Call OpenAI API with tools
      const aiResponse = await this.client.chatCompletion(
        currentMessages,
        enhancedSystemPrompt,
        availableTools,
        { model: modelUsed }
      );
      
      const choice = aiResponse.choices[0];
      if (!choice) {
        throw new Error('No response from AI');
      }
      
      const message = choice.message;
      console.log(`[OpenClaw Tool Integration] Response received, has tool_calls: ${!!message.tool_calls}`);
      
      // Check for tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(`[OpenClaw Tool Integration] Found ${message.tool_calls.length} tool calls`);
        
        // Add assistant message with tool calls to conversation
        currentMessages.push({
          role: 'assistant',
          content: '', // Tool calls are handled separately
          timestamp: new Date(),
        });
        
        // Execute each tool call
        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== 'function') {
            console.warn(`[OpenClaw Tool Integration] Skipping non-function tool call: ${toolCall.type}`);
            continue;
          }
          
          const toolName = toolCall.function.name;
          let toolArgs: any;
          
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch (error) {
            console.warn(`[OpenClaw Tool Integration] Failed to parse tool arguments:`, toolCall.function.arguments);
            toolArgs = {};
          }
          
          console.log(`[OpenClaw Tool Integration] Executing tool: ${toolName}`, toolArgs);
          
          // Execute tool
          const result = await this.executeToolCall(toolName, toolArgs, 'ai-session');
          toolCalls.push(result);
          
          // Add tool result to conversation
          const toolResultMessage: Message = {
            role: 'user', // Tool results come from "user" (the system)
            content: result.success 
              ? `Tool ${toolName} result: ${typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}`
              : `Tool ${toolName} error: ${result.error}`,
            timestamp: new Date(),
          };
          
          currentMessages.push(toolResultMessage);
        }
        
        // Continue loop to get next AI response
        continue;
      } else {
        // No tool calls, this is the final response
        finalResponse = message.content || '';
        console.log(`[OpenClaw Tool Integration] Final response length: ${finalResponse.length}`);
        break;
      }
    }
    
    // If we hit max iterations without final response, get a final response
    if (!finalResponse && iteration >= this.maxToolCalls) {
      console.log(`[OpenClaw Tool Integration] Max iterations reached, getting final response`);
      const finalCompletion = await this.client.simpleCompletion(
        currentMessages,
        enhancedSystemPrompt,
        { model: modelUsed }
      );
      finalResponse = finalCompletion;
    }
    
    return {
      response: finalResponse,
      toolCalls,
      modelUsed,
    };
  }
  
  /**
   * Enhance system prompt with tool descriptions (like OpenClaw does)
   */
  private enhanceSystemPrompt(
    systemPrompt: string,
    tools: Array<{ name: string; description: string; parameters: any }>,
    modelId: string
  ): string {
    if (tools.length === 0) {
      return systemPrompt;
    }
    
    // Build tool descriptions (concise, like OpenClaw)
    const toolDescriptions = tools
      .map(tool => `- ${tool.name}: ${tool.description}`)
      .join('\n');
    
    // Tool instructions section
    const toolSection = `

## Available Tools

${toolDescriptions}

## Instructions
- Use tools when appropriate to complete tasks
- The system will automatically execute tools when you use them
- After a tool executes, you'll see the result and can continue the conversation
`;
    
    // Append tool section to system prompt
    // Try to insert before existing "## Instructions" section
    if (systemPrompt.includes('## Instructions:')) {
      const parts = systemPrompt.split('## Instructions:');
      return parts[0] + toolSection + '\n## Instructions:' + parts[1];
    }
    
    // Otherwise append to the end
    return systemPrompt + toolSection;
  }
  
  /**
   * Execute a tool call
   */
  private async executeToolCall(
    toolName: string,
    args: Record<string, any>,
    sessionId: string
  ): Promise<ToolCallResult> {
    try {
      // Check if tool exists
      const tool = this.toolManager.getTool(toolName);
      if (!tool) {
        return {
          tool: toolName,
          success: false,
          error: `Tool not found: ${toolName}`
        };
      }
      
      // Create tool context
      const context = {
        sessionId,
        workspacePath: process.cwd(),
      };
      
      // Execute tool using the ToolManager
      const result = await this.toolManager.callTool(toolName, args, context);
      
      return {
        tool: toolName,
        success: result.success,
        result: result.result,
        error: result.error
      };
    } catch (error) {
      console.error(`[OpenClaw Tool Integration] Tool execution failed:`, error);
      return {
        tool: toolName,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Simple completion without tools
   */
  async simpleComplete(
    messages: Message[],
    systemPrompt: string = '',
    forceModel?: string
  ): Promise<string> {
    const model = forceModel || this.client.defaultModel;
    const response = await this.client.simpleCompletion(
      messages,
      systemPrompt,
      { model }
    );
    return response;
  }
  
  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.client.healthCheck();
  }
  
  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    return this.client.listModels();
  }
  
  /**
   * Update options
   */
  updateOptions(options: Partial<OpenClawToolIntegrationOptions>): void {
    this.client.updateOptions({
      baseUrl: options.baseUrl,
      defaultModel: options.defaultModel,
      temperature: options.temperature,
    });
    if (options.maxToolCalls !== undefined) {
      this.maxToolCalls = options.maxToolCalls;
    }
  }
}