import type { ToolManager } from './tool-manager.js';
import type { Message } from '../context/types.js';
import { OpenAIOllamaClient, type OpenAIMessage, type OpenAITool } from '../ollama/openai-client.js';
import { ModelTemplateRegistry } from '../ollama/model-templates.js';

export interface ToolCallResult {
  tool: string;
  success: boolean;
  result?: any;
  error?: string;
}

export interface OpenAIToolEnabledOptions {
  maxToolCalls?: number;
  allowDangerousTools?: boolean;
  requireApproval?: boolean;
  baseUrl?: string;
  model?: string;
  temperature?: number;
}

export class OpenAIToolIntegration {
  private openaiClient: OpenAIOllamaClient;
  private templateRegistry: ModelTemplateRegistry;
  
  constructor(
    private toolManager: ToolManager,
    options: OpenAIToolEnabledOptions = {}
  ) {
    this.openaiClient = new OpenAIOllamaClient({
      baseUrl: options.baseUrl,
      model: options.model,
      temperature: options.temperature,
    });
    this.templateRegistry = new ModelTemplateRegistry();
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
    const maxToolCalls = 5;
    const toolCalls: ToolCallResult[] = [];
    
    // Get available tools
    const availableTools = this.toolManager.listTools();
    console.log(`[OpenAI Tool Integration] Available tools: ${availableTools.length}`);
    
    // Convert to OpenAI tool format
    const openaiTools: OpenAITool[] = this.convertToolsToOpenAI(availableTools);
    
    // Enhance system prompt with tool descriptions (like OpenClaw does)
    const enhancedSystemPrompt = this.enhanceSystemPromptWithTools(systemPrompt, availableTools);
    
    // Convert messages to OpenAI format with enhanced system prompt
    const openaiMessages = this.convertToOpenAIMessages(messages, enhancedSystemPrompt);
    
    let currentMessages = [...openaiMessages];
    let iteration = 0;
    let finalResponse = '';
    let modelUsed = forceModel || 'llama3.2:latest'; // Default model
    
    while (iteration < maxToolCalls) {
      iteration++;
      console.log(`[OpenAI Tool Integration] Iteration ${iteration}/${maxToolCalls}, messages: ${currentMessages.length}`);
      
      // Prepare request with tools
      const requestOptions: any = {
        model: modelUsed,
        temperature: 0.7,
        max_tokens: 2048,
        timeout: 120000,
      };
      
      // Only include tools if we have any
      if (openaiTools.length > 0) {
        requestOptions.tools = openaiTools;
        requestOptions.tool_choice = 'auto';
      }
      
      // Get AI response
      let aiResponse;
      try {
        aiResponse = await this.openaiClient.chatCompletion(currentMessages, requestOptions);
        console.log(`[OpenAI Tool Integration] Response received, choices: ${aiResponse.choices.length}`);
      } catch (error) {
        console.error(`[OpenAI Tool Integration] API call failed:`, error);
        throw error;
      }
      
      const choice = aiResponse.choices[0];
      if (!choice) {
        throw new Error('No response from AI');
      }
      
      const message = choice.message;
      modelUsed = aiResponse.model;
      
      // Check for tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(`[OpenAI Tool Integration] Found ${message.tool_calls.length} tool calls`);
        
        // Add assistant message with tool calls to conversation
        currentMessages.push(message);
        
        // Execute each tool call
        for (const toolCall of message.tool_calls) {
          if (toolCall.type !== 'function') {
            console.warn(`[OpenAI Tool Integration] Skipping non-function tool call: ${toolCall.type}`);
            continue;
          }
          
          const toolName = toolCall.function.name;
          let toolArgs: any;
          
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch (error) {
            console.warn(`[OpenAI Tool Integration] Failed to parse tool arguments:`, toolCall.function.arguments);
            toolArgs = {};
          }
          
          console.log(`[OpenAI Tool Integration] Executing tool: ${toolName}`, toolArgs);
          
          // Execute tool
          const result = await this.executeToolCall(toolName, toolArgs, 'ai-session');
          toolCalls.push(result);
          
          // Add tool result to conversation
          const toolResultMessage: OpenAIMessage = {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.success 
              ? (typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2))
              : `Error: ${result.error}`,
          };
          
          currentMessages.push(toolResultMessage);
        }
        
        // Continue loop to get next AI response
        continue;
      } else {
        // No tool calls, this is the final response
        finalResponse = message.content || '';
        console.log(`[OpenAI Tool Integration] Final response length: ${finalResponse.length}`);
        break;
      }
    }
    
    return {
      response: finalResponse,
      toolCalls,
      modelUsed,
    };
  }
  
  private convertToolsToOpenAI(tools: Array<{
    name: string;
    description: string;
    parameters: any;
  }>): OpenAITool[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
  
  private enhanceSystemPromptWithTools(
    systemPrompt: string,
    tools: Array<{ name: string; description: string; parameters: any }>
  ): string {
    if (tools.length === 0) {
      return systemPrompt;
    }
    
    // Add tool section like OpenClaw does
    const toolSection = `
## Available Tools

${tools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

## Tool Calling Instructions
- Use tools when appropriate to complete tasks
- For file operations, use: read, write, edit, list, mkdir, delete, copy, move, file_info, search
- For system operations, use: exec, env, ps, kill (requires approval)
- For git operations, use: git_status, git_log
- For network operations, use: http_request
- For scripting, use: create_script

## Tool Calling
- Use tools when appropriate to complete tasks
- The system will automatically handle tool execution when you use tools
- For file operations, use: read, write, edit, list, mkdir, delete, copy, move, file_info, search
- For system operations, use: exec, env, ps, kill (requires approval)
- For git operations, use: git_status, git_log
- For network operations, use: http_request
- For scripting, use: create_script
`;
    
    // Insert tool section before the final "## Instructions:" section if it exists
    if (systemPrompt.includes('## Instructions:')) {
      const parts = systemPrompt.split('## Instructions:');
      return parts[0] + toolSection + '\n## Instructions:' + parts[1];
    }
    
    // Otherwise append to the end
    return systemPrompt + '\n' + toolSection;
  }
  
  private convertToOpenAIMessages(messages: Message[], systemPrompt: string): OpenAIMessage[] {
    const openaiMessages: OpenAIMessage[] = [];
    
    // Add system prompt if provided
    if (systemPrompt && systemPrompt.trim().length > 0) {
      openaiMessages.push({
        role: 'system',
        content: systemPrompt
      });
    }
    
    // Convert user/assistant messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        // Combine with existing system prompt or add as separate system message
        if (openaiMessages.length > 0 && openaiMessages[0].role === 'system') {
          openaiMessages[0].content += '\n\n' + msg.content;
        } else {
          openaiMessages.unshift({
            role: 'system',
            content: msg.content
          });
        }
      } else {
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        });
      }
    }
    
    return openaiMessages;
  }
  
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
      
      // Execute tool using the ToolManager's callTool method
      const result = await this.toolManager.callTool(toolName, args, context);
      
      return {
        tool: toolName,
        success: result.success,
        result: result.result,
        error: result.error
      };
    } catch (error) {
      console.error(`[OpenAI Tool Integration] Tool execution failed:`, error);
      return {
        tool: toolName,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  async healthCheck(): Promise<boolean> {
    return this.openaiClient.healthCheck();
  }
  
  async listModels(): Promise<string[]> {
    return this.openaiClient.listModels();
  }
  
  updateOptions(options: Partial<OpenAIToolEnabledOptions>): void {
    this.openaiClient.updateOptions({
      baseUrl: options.baseUrl,
      model: options.model,
      temperature: options.temperature,
    });
  }
}