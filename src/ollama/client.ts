import axios from 'axios';
import type { Message } from '../context/types.js';

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  response?: string;  // For generate endpoint
  message?: {        // For chat endpoint
    role: string;
    content: string;
  };
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaCompletionRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    stop?: string[];
    seed?: number;
  };
  system?: string;
  template?: string;
  context?: number[];
  raw?: boolean;
  format?: string;
}

export interface OllamaRequestOptions extends Partial<OllamaCompletionRequest> {
  timeout?: number;
}

export class OllamaClient {
  private baseUrl: string;
  private defaultModel: string;
  private defaultOptions: Required<OllamaCompletionRequest>['options'];
  
  constructor(options: OllamaOptions = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.defaultModel = options.model || 'llama3.1:8b'; // Changed from qwen3:latest
    this.defaultOptions = {
      temperature: options.temperature || 0.7,
      num_predict: options.maxTokens || 2048,
      top_p: 0.9,
      top_k: 40,
      stop: [],
      seed: 0,
    };
  }
  
  async *streamGenerate(
    prompt: string,
    options: OllamaRequestOptions = {}
  ): AsyncGenerator<{ chunk: string; done: boolean }, void, unknown> {
    const request: OllamaCompletionRequest = {
      model: options.model || this.defaultModel,
      prompt,
      stream: true,
      options: {
        ...this.defaultOptions,
        ...options.options,
      },
      system: options.system,
      context: options.context,
    };
    
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/generate`,
        request,
        {
          timeout: options.timeout || 120000,
          headers: {
            'Content-Type': 'application/json',
          },
          responseType: 'stream',
        }
      );
      
      const stream = response.data;
      
      for await (const chunk of stream) {
        const lines = chunk.toString().split('\n').filter((line: string) => line.trim());
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (data === '[DONE]') {
              yield { chunk: '', done: true };
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.response) {
                yield { chunk: parsed.response, done: parsed.done };
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      throw error;
    }
  }
  
  async generate(
    prompt: string,
    options: OllamaRequestOptions = {}
  ): Promise<OllamaResponse> {
    const request: OllamaCompletionRequest = {
      model: options.model || this.defaultModel,
      prompt,
      stream: false,
      options: {
        ...this.defaultOptions,
        ...options.options,
      },
      system: options.system,
      context: options.context,
    };
    
    try {
      const response = await axios.post<OllamaResponse>(
        `${this.baseUrl}/api/generate`,
        request,
        {
          timeout: options.timeout || 120000, // Increased to 120s for large context models
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data?.error || error.message;
        throw new Error(
          `Ollama API error: ${error.response?.status} ${error.response?.statusText} - ${errorMessage}`
        );
      }
      throw error;
    }
  }
  
  async generateWithContext(
    messages: Message[],
    systemPrompt: string = '',
    options: OllamaRequestOptions = {}
  ): Promise<OllamaResponse> {
    // Convert messages to prompt format
    const prompt = this.formatMessages(messages, systemPrompt);
    
    return this.generate(prompt, {
      ...options,
      system: systemPrompt,
    });
  }
  
  async chat(
    messages: Message[],
    systemPrompt: string = '',
    options: OllamaRequestOptions = {}
  ): Promise<OllamaResponse> {
    // Ollama's chat endpoint (if available)
    try {
      // Prepare messages array with system prompt as first message if provided
      const chatMessages = [...messages];
      
      if (systemPrompt && systemPrompt.trim()) {
        // Add system prompt as first message with role: 'system'
        chatMessages.unshift({
          role: 'system',
          content: systemPrompt,
          timestamp: new Date()
        });
      }
      
      const request = {
        model: options.model || this.defaultModel,
        messages: chatMessages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        stream: false,
        options: {
          ...this.defaultOptions,
          ...options.options,
        },
      };
      
      const response = await axios.post<OllamaResponse>(
        `${this.baseUrl}/api/chat`,
        request,
        {
          timeout: options.timeout || 120000, // Increased to 120s for large context models
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      return response.data;
    } catch (error) {
      // Fall back to generate endpoint if chat isn't supported
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return this.generateWithContext(messages, systemPrompt, options);
      }
      throw error;
    }
  }
  
  async *streamChat(
    messages: Message[],
    systemPrompt: string = '',
    options: OllamaRequestOptions = {}
  ): AsyncGenerator<{ chunk: string; done: boolean }, void, unknown> {
    // Convert messages to chat format
    const chatMessages: Array<{ role: string; content: string }> = [];
    
    if (systemPrompt) {
      chatMessages.push({
        role: 'system',
        content: systemPrompt,
      });
    }
    
    for (const msg of messages) {
      chatMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }
    
    const request = {
      model: options.model || this.defaultModel,
      messages: chatMessages,
      stream: true,
      options: {
        ...this.defaultOptions,
        ...options.options,
      },
    };
    
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/chat`,
        request,
        {
          timeout: options.timeout || 120000,
          headers: {
            'Content-Type': 'application/json',
          },
          responseType: 'stream',
        }
      );
      
      const stream = response.data;
      
      for await (const chunk of stream) {
        const lines = chunk.toString().split('\n').filter((line: string) => line.trim());
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (data === '[DONE]') {
              yield { chunk: '', done: true };
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.message?.content) {
                yield { chunk: parsed.message.content, done: parsed.done };
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      // Fall back to generate streaming if chat isn't supported
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Combine messages into a single prompt for generate
        const prompt = chatMessages.map(m => `${m.role}: ${m.content}`).join('\n');
        yield* this.streamGenerate(prompt, options);
      } else {
        throw error;
      }
    }
  }
  
  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get<{ models: Array<{ name: string }> }>(
        `${this.baseUrl}/api/tags`
      );
      
      return response.data.models.map(model => model.name);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        throw new Error(
          `Failed to list Ollama models: ${status} ${statusText}`
        );
      }
      throw error;
    }
  }
  
  async getModelInfo(modelName: string = this.defaultModel): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/show`,
        { name: modelName }
      );
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        throw new Error(
          `Failed to get model info: ${status} ${statusText}`
        );
      }
      throw error;
    }
  }
  
  async pullModel(modelName: string): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/api/pull`,
        { name: modelName, stream: false }
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        throw new Error(
          `Failed to pull model: ${status} ${statusText}`
        );
      }
      throw error;
    }
  }
  
  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
  
  private formatMessages(messages: Message[], systemPrompt: string = ''): string {
    const parts: string[] = [];
    
    if (systemPrompt) {
      parts.push(`System: ${systemPrompt}\n\n`);
    }
    
    for (const message of messages) {
      const role = message.role === 'assistant' ? 'Assistant' : 'User';
      parts.push(`${role}: ${message.content}\n`);
    }
    
    parts.push('Assistant:');
    return parts.join('');
  }
  
  updateOptions(options: Partial<OllamaOptions>): void {
    if (options.baseUrl) this.baseUrl = options.baseUrl;
    if (options.model) this.defaultModel = options.model;
    if (options.temperature !== undefined) {
      this.defaultOptions.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      this.defaultOptions.num_predict = options.maxTokens;
    }
  }
}