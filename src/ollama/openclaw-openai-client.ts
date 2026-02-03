import axios from 'axios';
import { ModelTemplateRegistry } from './model-templates.js';
import type { Message } from '../context/types.js';

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
    strict?: boolean;
  };
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content: any; // Can be string or array - OpenAI accepts both
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface OpenAICompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface OpenAICompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenClawOpenAIOptions {
  baseUrl?: string;
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export class OpenClawOpenAIClient {
  private baseUrl: string;
  private _defaultModel: string;
  
  get defaultModel(): string {
    return this._defaultModel;
  }
  private defaultOptions: {
    temperature: number;
    max_tokens: number;
  };
  private templateRegistry: ModelTemplateRegistry;
  
  constructor(options: OpenClawOpenAIOptions = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this._defaultModel = options.defaultModel || 'llama3.2:latest';
    this.defaultOptions = {
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 2048,
    };
    this.templateRegistry = new ModelTemplateRegistry();
  }
  
  /**
   * Convert tools to OpenAI format (like OpenClaw's convertResponsesTools)
   */
  convertToolsToOpenAI(tools: Array<{
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
        strict: false,
      },
    }));
  }
  
  /**
   * Convert messages to OpenAI format with proper model-specific formatting
   * (like OpenClaw's convertResponsesMessages)
   */
  convertMessagesToOpenAI(
    messages: Message[],
    systemPrompt: string = '',
    modelId: string
  ): OpenAIMessage[] {
    const openaiMessages: OpenAIMessage[] = [];
    const modelFamily = this.detectModelFamily(modelId);
    const template = this.templateRegistry.getTemplate(modelFamily);
    
    // Add system prompt if provided
    if (systemPrompt && systemPrompt.trim().length > 0) {
      if (template.supportsTools && template.toolFormat === 'openai') {
        // For OpenAI-compatible models, use standard system role
        openaiMessages.push({
          role: 'system',
          content: systemPrompt,
        });
      } else if (modelFamily === 'qwen') {
        // Qwen needs special formatting
        openaiMessages.push({
          role: 'system',
          content: systemPrompt,
        });
      } else {
        // Default to system role
        openaiMessages.push({
          role: 'system',
          content: systemPrompt,
        });
      }
    }
    
    // Convert conversation messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        // Combine with existing system message or add as separate
        if (openaiMessages.length > 0 && openaiMessages[0].role === 'system') {
          const existingContent = openaiMessages[0].content;
          if (typeof existingContent === 'string') {
            openaiMessages[0].content = existingContent + '\n\n' + msg.content;
          }
        } else {
          openaiMessages.unshift({
            role: 'system',
            content: msg.content,
          });
        }
      } else if (msg.role === 'user') {
        openaiMessages.push({
          role: 'user',
          content: msg.content as string, // Cast to string for simplicity
        });
      } else if (msg.role === 'assistant') {
        // Check if assistant message contains tool calls
        const content = msg.content;
        
        // Simple implementation - in real OpenClaw, this would parse tool calls
        openaiMessages.push({
          role: 'assistant',
          content: content as string, // Cast to string for simplicity
        });
      }
    }
    
    return openaiMessages;
  }
  
  /**
   * Detect model family from model ID
   */
  private detectModelFamily(modelId: string): string {
    const id = modelId.toLowerCase();
    
    if (id.includes('qwen')) {
      return 'qwen';
    } else if (id.includes('llama')) {
      return 'llama';
    } else if (id.includes('mistral')) {
      return 'mistral';
    } else if (id.includes('gemma')) {
      return 'gemma';
    } else if (id.includes('command-r')) {
      return 'command-r';
    } else {
      return 'default';
    }
  }
  
  /**
   * Main chat completion method (OpenClaw-style)
   */
  async chatCompletion(
    messages: Message[],
    systemPrompt: string = '',
    tools: Array<{
      name: string;
      description: string;
      parameters: any;
    }> = [],
    options: Partial<OpenAICompletionRequest> & { timeout?: number } = {}
  ): Promise<OpenAICompletionResponse> {
    const model = options.model || this.defaultModel;
    const timeout = options.timeout || 120000;
    
    // Convert messages to OpenAI format
    const openaiMessages = this.convertMessagesToOpenAI(messages, systemPrompt, model);
    
    // Convert tools to OpenAI format
    const openaiTools = tools.length > 0 ? this.convertToolsToOpenAI(tools) : undefined;
    
    // Prepare request
    const request: OpenAICompletionRequest = {
      model,
      messages: openaiMessages,
      temperature: options.temperature || this.defaultOptions.temperature,
      max_tokens: options.max_tokens || this.defaultOptions.max_tokens,
      stream: false,
    };
    
    // Add tools if provided
    if (openaiTools && openaiTools.length > 0) {
      request.tools = openaiTools;
      request.tool_choice = 'auto';
    }
    
    console.log(`[OpenClaw OpenAI Client] Sending request to ${this.baseUrl}/v1/chat/completions`);
    console.log(`[OpenClaw OpenAI Client] Model: ${model}, Messages: ${openaiMessages.length}, Tools: ${openaiTools?.length || 0}`);
    
    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/chat/completions`,
        request,
        {
          timeout,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      const data = response.data;
      console.log(`[OpenClaw OpenAI Client] Response received, choices: ${data.choices?.length || 0}`);
      
      if (data.choices?.[0]?.message?.tool_calls) {
        console.log(`[OpenClaw OpenAI Client] Tool calls: ${data.choices[0].message.tool_calls.length}`);
      }
      
      return data;
    } catch (error: any) {
      console.error(`[OpenClaw OpenAI Client] API error:`, error.message);
      if (axios.isAxiosError(error)) {
        console.error(`[OpenClaw OpenAI Client] Response:`, error.response?.data);
      }
      throw error;
    }
  }
  
  /**
   * Simple completion without tools
   */
  async simpleCompletion(
    messages: Message[],
    systemPrompt: string = '',
    options: Partial<OpenAICompletionRequest> = {}
  ): Promise<string> {
    const response = await this.chatCompletion(messages, systemPrompt, [], options);
    return response.choices[0]?.message?.content || '';
  }
  
  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/v1/models`, {
        timeout: 5000,
      });
      return true;
    } catch (error) {
      // Try legacy endpoint
      try {
        await axios.get(`${this.baseUrl}/api/tags`, {
          timeout: 5000,
        });
        return true;
      } catch {
        return false;
      }
    }
  }
  
  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/v1/models`, {
        timeout: 10000,
      });
      return response.data.data.map((model: any) => model.id);
    } catch (error) {
      // Fall back to legacy endpoint
      try {
        const response = await axios.get(`${this.baseUrl}/api/tags`, {
          timeout: 10000,
        });
        return response.data.models.map((model: any) => model.name);
      } catch {
        return [];
      }
    }
  }
  
  /**
   * Update options
   */
  updateOptions(options: Partial<OpenClawOpenAIOptions>): void {
    if (options.baseUrl) this.baseUrl = options.baseUrl;
    if (options.defaultModel) this._defaultModel = options.defaultModel;
    if (options.temperature !== undefined) this.defaultOptions.temperature = options.temperature;
    if (options.maxTokens !== undefined) this.defaultOptions.max_tokens = options.maxTokens;
  }
}