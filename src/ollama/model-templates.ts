export interface ModelTemplate {
  name: string;
  systemPrefix: string;
  systemSuffix: string;
  userPrefix: string;
  userSuffix: string;
  assistantPrefix: string;
  assistantSuffix: string;
  toolPrefix?: string;
  toolSuffix?: string;
  toolCallPrefix?: string;
  toolCallSuffix?: string;
  toolResponsePrefix?: string;
  toolResponseSuffix?: string;
  stopSequences: string[];
  supportsTools: boolean;
  toolFormat: 'openai' | 'qwen' | 'custom';
}

export class ModelTemplateRegistry {
  private templates: Map<string, ModelTemplate> = new Map();
  
  constructor() {
    this.registerDefaultTemplates();
  }
  
  private registerDefaultTemplates(): void {
    // Qwen template (uses <|im_start|> and <|im_end|>)
    this.templates.set('qwen', {
      name: 'qwen',
      systemPrefix: '<|im_start|>system\n',
      systemSuffix: '<|im_end|>\n',
      userPrefix: '<|im_start|>user\n',
      userSuffix: '<|im_end|>\n',
      assistantPrefix: '<|im_start|>assistant\n',
      assistantSuffix: '<|im_end|>\n',
      toolPrefix: '<|im_start|>user\n<tool_response>\n',
      toolSuffix: '\n</tool_response><|im_end|>\n',
      toolCallPrefix: '<tool_call>\n',
      toolCallSuffix: '\n</tool_call>',
      toolResponsePrefix: '<tool_response>\n',
      toolResponseSuffix: '\n</tool_response>',
      stopSequences: ['<|im_start|>', '<|im_end|>'],
      supportsTools: true,
      toolFormat: 'qwen'
    });
    
    // Llama template (standard instruction format)
    this.templates.set('llama', {
      name: 'llama',
      systemPrefix: '<<SYS>>\n',
      systemSuffix: '\n<</SYS>>\n\n',
      userPrefix: '[INST] ',
      userSuffix: ' [/INST]',
      assistantPrefix: '',
      assistantSuffix: '',
      toolPrefix: '[INST] Tool result: ',
      toolSuffix: ' [/INST]',
      toolCallPrefix: '<tool_call>',
      toolCallSuffix: '</tool_call>',
      toolResponsePrefix: 'Tool result: ',
      toolResponseSuffix: '',
      stopSequences: ['[INST]', '[/INST]', '<<SYS>>', '<</SYS>>'],
      supportsTools: false, // Llama doesn't have native tool support
      toolFormat: 'custom'
    });
    
    // OpenAI-compatible template
    this.templates.set('openai', {
      name: 'openai',
      systemPrefix: '',
      systemSuffix: '\n\n',
      userPrefix: 'User: ',
      userSuffix: '\n',
      assistantPrefix: 'Assistant: ',
      assistantSuffix: '\n',
      toolPrefix: 'User: Tool result: ',
      toolSuffix: '\n',
      toolCallPrefix: '<tool_call>',
      toolCallSuffix: '</tool_call>',
      toolResponsePrefix: 'Tool result: ',
      toolResponseSuffix: '',
      stopSequences: ['User:', 'Assistant:', '<tool_call>', '</tool_call>'],
      supportsTools: true,
      toolFormat: 'openai'
    });
    
    // Default template (simple)
    this.templates.set('default', {
      name: 'default',
      systemPrefix: 'System: ',
      systemSuffix: '\n\n',
      userPrefix: 'User: ',
      userSuffix: '\n',
      assistantPrefix: 'Assistant: ',
      assistantSuffix: '\n',
      stopSequences: ['User:', 'Assistant:'],
      supportsTools: false,
      toolFormat: 'custom'
    });
  }
  
  detectModelFamily(modelName: string): string {
    const lowerName = modelName.toLowerCase();
    
    // Models that support OpenAI tool calling via Ollama's API
    // Use 'openai' template for these to enable proper tool support
    if (lowerName.includes('qwen3-4b-instruct-2507') || 
        lowerName.includes('qwen3-4b') ||
        lowerName.includes('llama3.2') ||
        lowerName.includes('llama3.1') ||
        lowerName.includes('command-r') || 
        lowerName.includes('cohere')) {
      return 'openai';
    }
    
    // Fall back to model families
    if (lowerName.includes('qwen')) {
      return 'qwen';
    } else if (lowerName.includes('llama')) {
      return 'llama';
    } else if (lowerName.includes('mistral') || lowerName.includes('mixtral')) {
      return 'llama'; // Mistral uses similar format to Llama
    } else if (lowerName.includes('phi')) {
      return 'llama';
    } else if (lowerName.includes('gemma')) {
      return 'llama';
    } else {
      return 'default';
    }
  }
  
  /**
   * Check if a model supports OpenAI tool calling
   */
  supportsOpenAITools(modelName: string): boolean {
    const family = this.detectModelFamily(modelName);
    const template = this.templates.get(family) || this.templates.get('default')!;
    return template.supportsTools && template.toolFormat === 'openai';
  }
  
  getTemplate(modelName: string): ModelTemplate {
    const family = this.detectModelFamily(modelName);
    return this.templates.get(family) || this.templates.get('default')!;
  }
  
  formatSystemPrompt(prompt: string, modelName: string): string {
    const template = this.getTemplate(modelName);
    return `${template.systemPrefix}${prompt}${template.systemSuffix}`;
  }
  
  formatUserMessage(content: string, modelName: string): string {
    const template = this.getTemplate(modelName);
    return `${template.userPrefix}${content}${template.userSuffix}`;
  }
  
  formatAssistantMessage(content: string, modelName: string): string {
    const template = this.getTemplate(modelName);
    return `${template.assistantPrefix}${content}${template.assistantSuffix}`;
  }
  
  formatToolResult(content: string, modelName: string): string {
    const template = this.getTemplate(modelName);
    if (!template.toolPrefix || !template.toolSuffix) {
      return `Tool result: ${content}\n`;
    }
    return `${template.toolPrefix}${content}${template.toolSuffix}`;
  }
  
  formatToolCall(toolName: string, args: any, modelName: string): string {
    const template = this.getTemplate(modelName);
    
    if (template.toolFormat === 'qwen') {
      // Qwen format: {"name": "tool_name", "arguments": {...}}
      const toolCall = JSON.stringify({ name: toolName, arguments: args }, null, 2);
      return `${template.toolCallPrefix}${toolCall}${template.toolCallSuffix}`;
    } else if (template.toolFormat === 'openai') {
      // OpenAI format
      const toolCall = JSON.stringify({ tool: toolName, arguments: args }, null, 2);
      return `${template.toolCallPrefix}${toolCall}${template.toolCallSuffix}`;
    } else {
      // Custom format (our default)
      const toolCall = JSON.stringify({ tool: toolName, arguments: args });
      return `<tool_call>${toolCall}</tool_call>`;
    }
  }
  
  extractToolCalls(text: string, modelName: string): Array<{tool: string, arguments: any}> {
    const template = this.getTemplate(modelName);
    const toolCalls: Array<{tool: string, arguments: any}> = [];
    
    if (template.toolFormat === 'qwen') {
      // Extract Qwen format: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
      const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
      let match;
      
      while ((match = regex.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (parsed.name && parsed.arguments) {
            toolCalls.push({
              tool: parsed.name,
              arguments: parsed.arguments
            });
          }
        } catch (error) {
          console.warn('Failed to parse Qwen tool call:', error);
        }
      }
    } else {
      // Extract our format: <tool_call>{"tool": "...", "arguments": {...}}</tool_call>
      const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
      let match;
      
      while ((match = regex.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          const toolName = parsed.tool || parsed.name;
          const args = parsed.arguments || parsed.args || {};
          
          if (toolName && args) {
            toolCalls.push({
              tool: toolName,
              arguments: args
            });
          }
        } catch (error) {
          console.warn('Failed to parse tool call:', error);
        }
      }
    }
    
    return toolCalls;
  }
  
  cleanResponse(text: string, modelName: string): string {
    const template = this.getTemplate(modelName);
    
    // Remove tool call tags
    let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    
    // Remove thinking tags
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
    
    // Remove model-specific prefixes/suffixes
    if (template.assistantPrefix) {
      cleaned = cleaned.replace(new RegExp(`^${template.assistantPrefix}`), '');
    }
    if (template.assistantSuffix) {
      cleaned = cleaned.replace(new RegExp(`${template.assistantSuffix}$`), '');
    }
    
    // Remove stop sequences from the end
    for (const stop of template.stopSequences) {
      if (cleaned.endsWith(stop)) {
        cleaned = cleaned.slice(0, -stop.length);
      }
    }
    
    return cleaned.trim();
  }
}