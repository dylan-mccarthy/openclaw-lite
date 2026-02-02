import type { ModelProfile, TaskRequirements, ModelSelection } from './types.js';

export class ModelRouter {
  private models: Map<string, ModelProfile>;
  
  constructor() {
    this.models = new Map();
    this.initializeDefaultModels();
  }
  
  private initializeDefaultModels(): void {
    // Local models (Ollama) - llama3.1:8b is now default
    this.models.set('ollama/llama3.1:8b', {
      id: 'ollama/llama3.1:8b',
      contextWindow: 8192,
      maxOutputTokens: 4096,
      supportsTools: true,  // ✅ Tested and works
      supportsVision: false,
      isLocal: true
    });
    
    this.models.set('ollama/qwen3:latest', {
      id: 'ollama/qwen3:latest',
      contextWindow: 8192,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsVision: false,
      isLocal: true
      // Note: Currently returns empty responses - use llama3.1:8b instead
    });
    
    this.models.set('ollama/qwen2.5-coder:7b', {
      id: 'ollama/qwen2.5-coder:7b',
      contextWindow: 32768,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsVision: false,
      isLocal: true
    });
    
    this.models.set('ollama/deepseek-r1:8b', {
      id: 'ollama/deepseek-r1:8b',
      contextWindow: 32768,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsVision: false,
      isLocal: true
    });
    
    // Cloud models (fallback)
    this.models.set('deepseek/deepseek-chat', {
      id: 'deepseek/deepseek-chat',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsVision: false,
      isLocal: false,
      costPerInputToken: 0.00014,
      costPerOutputToken: 0.00028
    });
    
    this.models.set('openai-codex/gpt-5.2-codex', {
      id: 'openai-codex/gpt-5.2-codex',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      supportsTools: true,
      supportsVision: false,
      isLocal: false,
      costPerInputToken: 0.0005, // Estimated
      costPerOutputToken: 0.0015 // Estimated
    });
  }
  
  addModel(profile: ModelProfile): void {
    this.models.set(profile.id, profile);
  }
  
  removeModel(modelId: string): boolean {
    return this.models.delete(modelId);
  }
  
  selectModel(
    task: TaskRequirements,
    availableModels: string[] = Array.from(this.models.keys())
  ): ModelSelection {
    const candidates = availableModels
      .map(id => ({ id, profile: this.models.get(id) }))
      .filter(({ profile }) => profile) as { id: string, profile: ModelProfile }[];
    
    // Filter by basic requirements
    let filtered = candidates.filter(({ profile }) => {
      // Check capabilities
      if (task.needsTools && !profile.supportsTools) return false;
      if (task.needsVision && !profile.supportsVision) return false;
      
      // Check context window (leave 20% buffer)
      const maxInputTokens = profile.contextWindow * 0.8;
      if (task.estimatedInputTokens > maxInputTokens) return false;
      
      // Check output tokens
      if (task.estimatedOutputTokens > profile.maxOutputTokens) return false;
      
      return true;
    });
    
    if (filtered.length === 0) {
      throw new Error(
        `No suitable model found for task. Requirements: ` +
        `${task.estimatedInputTokens} input tokens, ` +
        `${task.estimatedOutputTokens} output tokens, ` +
        `tools: ${task.needsTools}, vision: ${task.needsVision}`
      );
    }
    
    // Rank by priority
    filtered = this.rankModels(filtered, task);
    
    const selected = filtered[0];
    const estimatedCost = this.estimateCost(selected.profile, task);
    
    return {
      modelId: selected.id,
      reason: this.generateSelectionReason(selected, filtered, task),
      estimatedCost,
      contextWindow: selected.profile.contextWindow
    };
  }
  
  private rankModels(
    candidates: { id: string, profile: ModelProfile }[],
    task: TaskRequirements
  ): { id: string, profile: ModelProfile }[] {
    return [...candidates].sort((a, b) => {
      const scoreA = this.calculateModelScore(a.profile, task);
      const scoreB = this.calculateModelScore(b.profile, task);
      return scoreB - scoreA; // Higher score = better
    });
  }
  
  private calculateModelScore(profile: ModelProfile, task: TaskRequirements): number {
    let score = 0;
    
    // Priority-based scoring
    switch (task.priority) {
      case 'local':
        if (profile.isLocal) score += 1000;
        break;
        
      case 'cost':
        const cost = this.estimateCost(profile, task);
        score += 1000 - (cost * 1000000); // Lower cost = higher score
        if (profile.isLocal) score += 500; // Local is free
        break;
        
      case 'speed':
        if (profile.isLocal) score += 800; // Local is usually faster
        // Smaller models might be faster
        if (profile.contextWindow <= 8192) score += 200;
        break;
        
      case 'quality':
        // Larger context window often correlates with better models
        score += profile.contextWindow * 0.1;
        if (!profile.isLocal) score += 300; // Cloud models often better quality
        break;
    }
    
    // Context window efficiency (closer to needed = better)
    const contextEfficiency = 1 - Math.abs(
      task.estimatedInputTokens - (profile.contextWindow * 0.6)
    ) / profile.contextWindow;
    score += contextEfficiency * 100;
    
    return score;
  }
  
  private estimateCost(profile: ModelProfile, task: TaskRequirements): number {
    if (profile.isLocal || !profile.costPerInputToken) return 0;
    
    const inputCost = task.estimatedInputTokens * profile.costPerInputToken;
    const outputCost = task.estimatedOutputTokens * (profile.costPerOutputToken || profile.costPerInputToken * 2);
    
    return inputCost + outputCost;
  }
  
  private generateSelectionReason(
    selected: { id: string, profile: ModelProfile },
    allCandidates: { id: string, profile: ModelProfile }[],
    task: TaskRequirements
  ): string {
    const reasons: string[] = [];
    
    if (task.priority === 'local' && selected.profile.isLocal) {
      reasons.push('matches local priority');
    }
    
    if (task.priority === 'cost') {
      const cost = this.estimateCost(selected.profile, task);
      if (cost === 0) {
        reasons.push('free (local model)');
      } else {
        reasons.push(`lowest cost ($${cost.toFixed(6)})`);
      }
    }
    
    if (selected.profile.isLocal) {
      reasons.push('local model for speed/privacy');
    }
    
    // Check if it has the largest context window among candidates
    const maxContext = Math.max(...allCandidates.map(c => c.profile.contextWindow));
    if (selected.profile.contextWindow === maxContext) {
      reasons.push('largest context window');
    }
    
    return reasons.join(', ');
  }
  
  getAvailableModels(): ModelProfile[] {
    return Array.from(this.models.values());
  }
  
  getModel(modelId: string): ModelProfile | undefined {
    return this.models.get(modelId);
  }
}