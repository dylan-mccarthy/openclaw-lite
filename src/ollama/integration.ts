import { ContextManager } from '../context/context-manager.js';
import { ModelRouter } from '../context/model-router.js';
import { TokenEstimator } from '../context/token-estimator.js';
import { OpenAIOllamaClient, type OpenAIOllamaOptions } from './openai-client.js';
import { ModelTemplateRegistry } from './model-templates.js';
import type { Message, TaskRequirements } from '../context/types.js';

export interface OllamaIntegrationOptions {
  ollama?: OpenAIOllamaOptions;
  context?: {
    maxContextTokens?: number;
    compressionStrategy?: 'truncate' | 'selective' | 'hybrid';
    keepFirstLast?: boolean;
  };
  modelSelection?: {
    defaultPriority?: 'local' | 'cost' | 'speed' | 'quality';
  };
}

export interface CompletionResult {
  response: string;
  modelUsed: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  timing?: {
    total: number;
    promptEval: number;
    eval: number;
  };
  context: {
    originalMessages: number;
    compressedMessages: number;
    compressionRatio: number;
  };
}

export class OllamaIntegration {
  private ollama: OpenAIOllamaClient;
  private contextManager: ContextManager;
  private modelRouter: ModelRouter;
  private tokenEstimator: TokenEstimator;
  private templateRegistry: ModelTemplateRegistry;
  
  constructor(options: OllamaIntegrationOptions = {}) {
    this.ollama = new OpenAIOllamaClient(options.ollama);
    this.contextManager = new ContextManager(options.context);
    this.modelRouter = new ModelRouter();
    this.tokenEstimator = new TokenEstimator();
    this.templateRegistry = new ModelTemplateRegistry();
  }
  
  async complete(
    messages: Message[],
    systemPrompt: string = '',
    taskRequirements?: TaskRequirements,
    forceModel?: string
  ): Promise<CompletionResult> {
    const startTime = Date.now();
    console.log(`[DEBUG] complete() called with ${messages.length} messages, systemPrompt length: ${systemPrompt.length}, forceModel: ${forceModel || 'none'}`);
    
    // 1. Analyze task if not provided
    const task = taskRequirements || this.analyzeTask(messages, systemPrompt);
    console.log(`[DEBUG] Task analyzed`);
    
    // 2. Select appropriate model
    let modelId: string;
    
    // Use forced model if specified
    if (forceModel) {
      modelId = forceModel.startsWith('ollama/') ? forceModel : `ollama/${forceModel}`;
    } else {
      try {
        const selection = this.modelRouter.selectModel(task);
        modelId = selection.modelId;
        
        // Check if selected model is available in Ollama
        if (modelId.startsWith('ollama/')) {
          const ollamaModel = modelId.replace('ollama/', '');
          
          // Verify model is available
          try {
            const availableModels = await this.ollama.listModels();
            if (!availableModels.includes(ollamaModel)) {
              console.warn(`Model ${ollamaModel} not found in Ollama, using default`);
              modelId = `ollama/${(this.ollama as any).defaultModel}`;
            }
          } catch (error) {
            console.warn(`Failed to list models: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        // Fall back to default Ollama model
        console.warn(`[DEBUG] Model selection failed: ${error instanceof Error ? error.message : String(error)}, using default`);
        modelId = `ollama/${(this.ollama as any).defaultModel}`;
      }
    }
    
    console.log(`[DEBUG] Final modelId: ${modelId}`);
    
    // 3. Compress context if needed
    const compressionResult = await this.contextManager.compressHistory(
      messages,
      systemPrompt,
      modelId
    );
    console.log(`[DEBUG] Context compressed: ${messages.length} -> ${compressionResult.messages.length} messages`);
    
    // 4. Estimate tokens
    const estimator = modelId.startsWith('ollama/')
      ? TokenEstimator.createForModel(modelId)
      : this.tokenEstimator;
    
    const inputTokens = estimator.estimateMessages(compressionResult.messages) + 
                       estimator.estimate(systemPrompt);
    console.log(`[DEBUG] Estimated input tokens: ${inputTokens}`);
    
    // 5. Call Ollama using OpenAI-compatible API
    const ollamaModel = modelId.replace('ollama/', '');
    
    console.log(`[DEBUG] Calling Ollama with model: ${ollamaModel}, messages: ${compressionResult.messages.length}, system prompt length: ${systemPrompt.length}`);
    
    let openaiResponse;
    try {
      const ollamaStart = Date.now();
      
      // Convert messages to OpenAI format
      const openaiMessages = this.convertToOpenAIMessages(compressionResult.messages, systemPrompt);
      
      // Call OpenAI-compatible endpoint
      openaiResponse = await this.ollama.chatCompletion(openaiMessages, {
        model: ollamaModel,
        temperature: 0.7,
        max_tokens: task.estimatedOutputTokens || 2048,
        timeout: 120000,
      });
      
      const ollamaDuration = Date.now() - ollamaStart;
      console.log(`[DEBUG] Ollama response received for model: ${ollamaModel} in ${ollamaDuration}ms`);
      console.log(`[DEBUG] OpenAI response keys: ${Object.keys(openaiResponse).join(', ')}`);
      console.log(`[DEBUG] OpenAI response has choices: ${!!openaiResponse.choices}`);
      console.log(`[DEBUG] OpenAI response usage: ${JSON.stringify(openaiResponse.usage)}`);
      
    } catch (error) {
      console.error(`[DEBUG] Ollama OpenAI API failed for ${ollamaModel}:`, error);
      throw error;
    }
    
    // 6. Extract response text
    const responseText = openaiResponse.choices?.[0]?.message?.content || 'No response generated';
    
    console.log(`[DEBUG] Extracted response text length: ${responseText.length}`);
    console.log(`[DEBUG] Response preview (first 200 chars): ${responseText.substring(0, 200).replace(/\n/g, '\\n')}`);
    
    // Check for thinking tags
    const hasThinkingTags = responseText.includes('<think>');
    console.log(`[DEBUG] Response has thinking tags: ${hasThinkingTags}`);
    if (hasThinkingTags) {
      const thinkMatch = responseText.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        console.log(`[DEBUG] Thinking content length: ${thinkMatch[1].length}`);
      }
    }
    
    // 7. Calculate output tokens
    const outputTokens = openaiResponse.usage?.completion_tokens || 
                        estimator.estimate(responseText);
    console.log(`[DEBUG] Output tokens: ${outputTokens} (completion_tokens: ${openaiResponse.usage?.completion_tokens || 'not provided'})`);
    
    const endTime = Date.now();
    console.log(`[DEBUG] Returning completion result, total time: ${endTime - startTime}ms`);
    
    return {
      response: responseText,
      modelUsed: modelId,
      tokens: {
        input: openaiResponse.usage?.prompt_tokens || inputTokens,
        output: outputTokens,
        total: (openaiResponse.usage?.total_tokens || inputTokens + outputTokens),
      },
      timing: {
        total: endTime - startTime,
        promptEval: 0, // Not available from OpenAI API
        eval: 0,
      },
      context: {
        originalMessages: messages.length,
        compressedMessages: compressionResult.messages.length,
        compressionRatio: compressionResult.compressionRatio,
      },
    };
  }
  
  private convertToOpenAIMessages(messages: Message[], systemPrompt: string): any[] {
    const openaiMessages: any[] = [];
    
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
          role: msg.role,
          content: msg.content
        });
      }
    }
    
    return openaiMessages;
  }
  
  async simpleComplete(
    userMessage: string,
    history: Message[] = [],
    systemPrompt: string = 'You are a helpful AI assistant.'
  ): Promise<string> {
    const messages: Message[] = [
      ...history,
      { role: 'user', content: userMessage, timestamp: new Date() },
    ];
    
    try {
      const result = await this.complete(messages, systemPrompt);
      return result.response || 'No response generated';
    } catch (error) {
      console.error('Simple complete error:', error);
      throw error;
    }
  }
  
  async streamComplete(
    messages: Message[],
    systemPrompt: string = '',
    onChunk: (chunk: string) => void,
    taskRequirements?: TaskRequirements
  ): Promise<CompletionResult> {
    // For streaming, we'd need to use Ollama's streaming API
    // This is a simplified version that collects chunks
    const result = await this.complete(messages, systemPrompt, taskRequirements);
    
    // Simulate streaming by emitting chunks
    const chunkSize = 20;
    for (let i = 0; i < result.response.length; i += chunkSize) {
      const chunk = result.response.substring(i, i + chunkSize);
      onChunk(chunk);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    return result;
  }
  
  async healthCheck(): Promise<{
    ollama: boolean;
    models: string[];
    defaultModel: string;
  }> {
    const ollamaHealthy = await this.ollama.healthCheck();
    let models: string[] = [];
    
    if (ollamaHealthy) {
      try {
        models = await this.ollama.listModels();
      } catch (error) {
        console.warn('Failed to list models:', error instanceof Error ? error.message : String(error));
      }
    }
    
    return {
      ollama: ollamaHealthy,
      models,
      defaultModel: this.ollama['defaultModel'],
    };
  }
  
  updateOllamaConfig(options: Partial<OpenAIOllamaOptions>): void {
    this.ollama.updateOptions(options);
  }
  
  updateContextConfig(config: any): void {
    this.contextManager.updateConfig(config);
  }
  
  private analyzeTask(messages: Message[], systemPrompt: string): TaskRequirements {
    const lastMessage = messages[messages.length - 1];
    const userMessage = lastMessage?.role === 'user' ? lastMessage.content : '';
    
    // Simple analysis - can be enhanced
    const estimator = this.tokenEstimator;
    const inputTokens = estimator.estimateMessages(messages) + estimator.estimate(systemPrompt);
    
    return {
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: 1024, // Default
      needsTools: userMessage.includes('search') || 
                  userMessage.includes('find') ||
                  userMessage.includes('get') ||
                  userMessage.includes('look up'),
      needsVision: userMessage.includes('image') || 
                   userMessage.includes('picture') ||
                   userMessage.includes('photo'),
      priority: 'local', // Default to local for Ollama integration
    };
  }
}