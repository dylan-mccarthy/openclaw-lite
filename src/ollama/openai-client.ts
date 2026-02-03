import axios from 'axios';
import type { Message } from '../context/types.js';

export interface OpenAIOllamaOptions {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
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

export class OpenAIOllamaClient {
  private baseUrl: string;
  private defaultModel: string;
  private defaultOptions: {
    temperature: number;
    max_tokens: number;
  };
  
  constructor(options: OpenAIOllamaOptions = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.defaultModel = options.model || 'llama3.1:8b';
    this.defaultOptions = {
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 2048,
    };
  }
  
  async chatCompletion(
    messages: OpenAIMessage[],
    options: Partial<OpenAICompletionRequest> & { timeout?: number } = {}
  ): Promise<OpenAICompletionResponse> {
    const request: OpenAICompletionRequest = {
      model: options.model || this.defaultModel,
      messages,
      temperature: options.temperature || this.defaultOptions.temperature,
      max_tokens: options.max_tokens || this.defaultOptions.max_tokens,
      stream: false,
    };
    
    // Remove timeout from request object (not part of OpenAI spec)
    const timeout = options.timeout || 120000;
    
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
      
      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        // Fall back to /api/chat if /v1 endpoint not available
        if (error.response?.status === 404) {
          return this.fallbackToApiChat(messages, request);
        }
        throw new Error(`Ollama OpenAI API error: ${error.response?.data?.error || error.message}`);
      }
      throw error;
    }
  }
  
  private async fallbackToApiChat(
    messages: OpenAIMessage[],
    originalRequest: OpenAICompletionRequest
  ): Promise<OpenAICompletionResponse> {
    console.warn('OpenAI-compatible endpoint not found, falling back to /api/chat');
    
    try {
      // Convert to Ollama's /api/chat format
      const ollamaMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        ...(msg.tool_calls && { tool_calls: msg.tool_calls })
      }));
      
      const request = {
        model: originalRequest.model,
        messages: ollamaMessages,
        options: {
          temperature: originalRequest.temperature,
          num_predict: originalRequest.max_tokens,
        },
        stream: false,
      };
      
      const response = await axios.post(
        `${this.baseUrl}/api/chat`,
        request,
        {
          timeout: 120000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      // Convert response to OpenAI format
      const ollamaResponse = response.data;
      return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: ollamaResponse.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: ollamaResponse.message?.content || '',
          },
          finish_reason: ollamaResponse.done_reason || 'stop',
        }],
        usage: {
          prompt_tokens: ollamaResponse.prompt_eval_count || 0,
          completion_tokens: ollamaResponse.eval_count || 0,
          total_tokens: (ollamaResponse.prompt_eval_count || 0) + (ollamaResponse.eval_count || 0),
        },
      };
    } catch (error: any) {
      throw new Error(`Fallback to /api/chat failed: ${error.message}`);
    }
  }
  
  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/v1/models`, {
        timeout: 5000,
      });
      return true;
    } catch (error) {
      // Try the legacy endpoint
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
  
  convertToOpenAIMessages(messages: Message[]): OpenAIMessage[] {
    return messages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content,
    }));
  }
  
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
      },
    }));
  }
  
  updateOptions(options: Partial<OpenAIOllamaOptions>): void {
    if (options.baseUrl) this.baseUrl = options.baseUrl;
    if (options.model) this.defaultModel = options.model;
    if (options.temperature !== undefined) this.defaultOptions.temperature = options.temperature;
    if (options.maxTokens !== undefined) this.defaultOptions.max_tokens = options.maxTokens;
  }
}