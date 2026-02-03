import type { ToolManager } from './tool-manager.js';
import type { Message } from '../context/types.js';
import { ModelTemplateRegistry } from '../ollama/model-templates.js';
import type { OpenAIOllamaClient, OpenAIMessage, OpenAITool } from '../ollama/openai-client.js';

export interface ToolCall {
  tool: string;
  arguments: Record<string, any>;
  reasoning?: string;
}

export interface ToolCallResult {
  tool: string;
  success: boolean;
  result?: any;
  error?: string;
}

export interface ToolEnabledCompletionOptions {
  maxToolCalls?: number;
  allowDangerousTools?: boolean;
  requireApproval?: boolean;
}

export class ToolEnabledIntegration {
  private templateRegistry: ModelTemplateRegistry;
  
  constructor(
    private toolManager: ToolManager,
    private baseIntegration: any, // Original OllamaIntegration
    private options: ToolEnabledCompletionOptions = {}
  ) {
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
    const maxToolCalls = this.options.maxToolCalls || 3;
    const toolCalls: ToolCallResult[] = [];
    
    // Enhanced system prompt with tool descriptions
    const enhancedSystemPrompt = this.enhanceSystemPrompt(systemPrompt, forceModel);
    
    let currentMessages = [...messages];
    let iteration = 0;
    let finalResponse = '';
    
    while (iteration < maxToolCalls) {
      iteration++;
      console.log(`[Tool Integration] Iteration ${iteration}/${maxToolCalls}`);
      
      // Get AI response (may include tool calls)
      const aiResponse = await this.baseIntegration.complete(
        currentMessages,
        enhancedSystemPrompt,
        undefined, // taskRequirements
        forceModel
      );
      
      // Parse tool calls from response
      const parsed = this.parseToolCalls(aiResponse.response);
      console.log(`[Tool Integration] Parsed ${parsed.toolCalls.length} tool calls, remaining text: ${parsed.remainingText.length} chars`);
      
      if (parsed.toolCalls.length === 0) {
        // No tool calls, this is the final response
        finalResponse = aiResponse.response;
        break;
      }
      
      // Execute tool calls
      for (const toolCall of parsed.toolCalls) {
        console.log(`[Tool Integration] Executing tool: ${toolCall.tool}`, toolCall.arguments);
        const result = await this.executeToolCall(toolCall, 'ai-session');
        toolCalls.push(result);
        
        // Add tool result to conversation in a format the AI understands
        const toolResultMessage = `Tool ${toolCall.tool} result: ${result.success ? 'SUCCESS' : 'ERROR'}`;
        if (result.success) {
          const resultStr = typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
          currentMessages.push({
            role: 'user',
            content: `[${toolResultMessage}]\n${resultStr.substring(0, 2000)}${resultStr.length > 2000 ? '... (truncated)' : ''}`,
            timestamp: new Date()
          });
        } else {
          currentMessages.push({
            role: 'user',
            content: `[${toolResultMessage}]\nError: ${result.error}`,
            timestamp: new Date()
          });
        }
      }
      
      // If we have remaining text after tool calls, add it as assistant message
      if (parsed.remainingText.trim()) {
        currentMessages.push({
          role: 'assistant',
          content: parsed.remainingText,
          timestamp: new Date()
        });
      }
      
      // Add a prompt to continue if we have tool results
      if (toolCalls.length > 0 && iteration < maxToolCalls) {
        currentMessages.push({
          role: 'user',
          content: 'Based on the tool results, what is your response to the original request?',
          timestamp: new Date()
        });
      }
    }
    
    // If we still don't have a final response (max iterations reached or no tool calls)
    if (!finalResponse) {
      const lastResponse = await this.baseIntegration.complete(
        currentMessages,
        enhancedSystemPrompt,
        undefined,
        forceModel
      );
      finalResponse = lastResponse.response;
    }
    
    // Clean up final response (remove any remaining tool call tags)
    finalResponse = finalResponse
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    
    return {
      response: finalResponse || 'I tried to use tools but encountered an issue.',
      toolCalls,
      modelUsed: forceModel || this.baseIntegration['options']?.model || 'unknown'
    };
  }

  private enhanceSystemPrompt(basePrompt: string, model?: string): string {
    const tools = this.toolManager.listTools();
    
    // Check if model is a Qwen model
    const isQwenModel = model?.toLowerCase().includes('qwen') || false;
    
    if (isQwenModel) {
      // Qwen format - simpler instructions since tools are handled by Ollama
      return `${basePrompt}

You are Ada, an AI assistant with access to tools. 

## HOW TO USE TOOLS:
When you need to perform an action, use the appropriate tool. Ollama will handle the tool calling format.

## IMPORTANT RULES:
- Think about what tool to use
- Provide clear reasoning if needed
- After the tool executes, you'll see the result
- You can make multiple tool calls if needed
- For file paths, use relative paths (e.g., "README.md" not "/home/...")

Remember: You are Ada - playful, helpful, and competent. Use tools when needed to help the user.`;
    } else {
      // Standard format for other models
      const toolDescriptions = tools.map(tool => {
        const params = Object.entries(tool.parameters)
          .map(([name, param]) => `${name}: ${param.description}${param.required ? ' (required)' : ''}`)
          .join(', ');
        
        return `TOOL: ${tool.name}
DESCRIPTION: ${tool.description}
PARAMETERS: ${params}
RETURNS: ${tool.returns.description}
${tool.dangerous ? 'WARNING: This tool is dangerous and requires approval.' : ''}
EXAMPLE: To read a file: <tool_call>{"tool": "read", "arguments": {"path": "filename.txt"}}</tool_call>`;
      }).join('\n\n');
      
      const toolCallingInstructions = `
# TOOL CALLING INSTRUCTIONS

You are Ada, an AI assistant with access to tools. When you need to perform an action, use tools.

## HOW TO USE TOOLS:
1. Think about what you need to do
2. Choose the appropriate tool
3. Format your response EXACTLY like this:

<think>
[Your reasoning about what tool to use]
</think>

<tool_call>
{"tool": "tool_name", "arguments": {"param1": "value1", "param2": "value2"}}
</tool_call>

## IMPORTANT RULES:
- ALWAYS use <tool_call> tags, NOT <read>, <write>, etc.
- The JSON must be valid and on a single line
- After the tool executes, you'll see the result
- You can make multiple tool calls if needed
- For file paths, use relative paths (e.g., "README.md" not "/home/...")

## AVAILABLE TOOLS:
${toolDescriptions}

## EXAMPLES:
User: "What's in the README file?"
You: <think>The user wants to see the README file contents. I should use the read tool.</think>
<tool_call>{"tool": "read", "arguments": {"path": "README.md"}}</tool_call>

User: "List files in the current directory"
You: <think>The user wants to see what files are available. I should use the list tool.</think>
<tool_call>{"tool": "list", "arguments": {"path": ".", "recursive": false}}</tool_call>

User: "Run a command to check disk space"
You: <think>The user wants to check disk space. I should use the exec tool with the df command.</think>
<tool_call>{"tool": "exec", "arguments": {"command": "df -h"}}</tool_call>

Remember: You are Ada - playful, helpful, and competent. Use tools when needed to help the user.
`;

      return `${basePrompt}\n\n${toolCallingInstructions}`;
    }
  }

  private parseToolCalls(response: string): {
    toolCalls: ToolCall[];
    remainingText: string;
  } {
    const toolCalls: ToolCall[] = [];
    let remainingText = response;
    
    // First, extract and remove all <think> tags
    const thinkTags: string[] = [];
    remainingText = remainingText.replace(/<think>([\s\S]*?)<\/think>/g, (_match, content) => {
      thinkTags.push(content.trim());
      return '';
    });
    
    // Look for <tool_call> tags specifically
    const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let match: RegExpExecArray | null;
    
    while ((match = toolCallRegex.exec(response)) !== null) {
      const [fullMatch, content] = match;
      
      try {
        // Try to parse as JSON
        const parsed = JSON.parse(content.trim());
        
        // Validate it's a tool call
        if (parsed.tool && typeof parsed.tool === 'string' && 
            parsed.arguments && typeof parsed.arguments === 'object') {
          
          // Clean up arguments (remove extra whitespace from string values)
          const cleanedArgs: Record<string, any> = {};
          for (const [key, value] of Object.entries(parsed.arguments)) {
            if (typeof value === 'string') {
              cleanedArgs[key] = value.trim();
            } else {
              cleanedArgs[key] = value;
            }
          }
          
          toolCalls.push({
            tool: parsed.tool.trim(),
            arguments: cleanedArgs,
            reasoning: parsed.reasoning || thinkTags.join('\n')
          });
          
          // Remove the tool call from remaining text
          remainingText = remainingText.replace(fullMatch, '');
        }
      } catch (error) {
        console.warn('Failed to parse tool call:', error, 'Content:', content);
        // Try to extract tool call from malformed JSON
        const toolMatch = content.match(/"tool"\s*:\s*"([^"]+)"/);
        if (toolMatch) {
          console.warn('Found tool name in malformed JSON:', toolMatch[1]);
        }
      }
    }
    
    // Clean up remaining text
    remainingText = remainingText
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '') // Remove any remaining tool calls
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    return { toolCalls, remainingText };
  }

  private async executeToolCall(toolCall: ToolCall, sessionId?: string): Promise<ToolCallResult> {
    try {
      // Validate tool exists
      const tool = this.toolManager.getTool(toolCall.tool);
      if (!tool) {
        return {
          tool: toolCall.tool,
          success: false,
          error: `Tool not found: ${toolCall.tool}. Available tools: ${this.toolManager.listTools().map(t => t.name).join(', ')}`
        };
      }
      
      // Validate required parameters
      const missingParams: string[] = [];
      for (const [paramName, paramDef] of Object.entries(tool.definition.parameters)) {
        if (paramDef.required && !(paramName in toolCall.arguments)) {
          missingParams.push(paramName);
        }
      }
      
      if (missingParams.length > 0) {
        return {
          tool: toolCall.tool,
          success: false,
          error: `Missing required parameters: ${missingParams.join(', ')}`
        };
      }
      
      // Execute tool
      const result = await this.toolManager.callTool(
        toolCall.tool,
        toolCall.arguments,
        {
          sessionId: sessionId || 'ai-tool-call',
          workspacePath: this.toolManager['options'].workspacePath,
          requireApproval: async (call) => {
            console.log(`[AI Tool] Approval required for ${call.tool}`);
            // For AI tool calls, auto-approve non-dangerous tools
            const tool = this.toolManager.getTool(call.tool);
            if (tool?.definition.dangerous && this.options.requireApproval) {
              console.log(`[AI Tool] Dangerous tool ${call.tool} requires approval`);
              return false; // Will be denied
            }
            return true; // Auto-approve
          },
          logUsage: async (log) => {
            console.log(`[AI Tool] ${log.call.tool}: ${log.result.success ? '✅' : '❌'} (${log.result.duration}ms)`);
            if (!log.result.success) {
              console.log(`[AI Tool] Error: ${log.result.error}`);
            }
          }
        }
      );
      
      return {
        tool: toolCall.tool,
        success: result.success,
        result: result.result,
        error: result.error
      };
    } catch (error) {
      return {
        tool: toolCall.tool,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  getToolManager(): ToolManager {
    return this.toolManager;
  }
}