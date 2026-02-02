import { describe, it, expect } from 'vitest';
import { ContextManager } from '../src/context/context-manager.js';
import { ModelRouter } from '../src/context/model-router.js';
import type { Message } from '../src/context/types.js';

describe('ContextManager', () => {
  it('should compress history when tokens exceed limit', async () => {
    const manager = new ContextManager({
      maxContextTokens: 500, // Very small limit
      reservedTokens: 100
    });
    
    // Create a conversation that's definitely too long
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}: ${'x'.repeat(200)}`, // Each ~50 tokens
        timestamp: new Date(),
        tokens: undefined
      });
    }
    
    const result = await manager.compressHistory(messages, 'System prompt');
    
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.compressedTokenCount).toBeLessThanOrEqual(400); // 500 - 100 reserved
    expect(result.compressionRatio).toBeLessThan(1);
  });
  
  it('should keep first and last messages when configured', async () => {
    const manager = new ContextManager({
      maxContextTokens: 500,
      reservedTokens: 100,
      keepFirstLast: true
    });
    
    const messages: Message[] = [
      { role: 'user', content: 'First message', timestamp: new Date(), tokens: undefined },
      { role: 'assistant', content: 'Response 1', timestamp: new Date(), tokens: undefined },
      { role: 'user', content: 'Middle message', timestamp: new Date(), tokens: undefined },
      { role: 'assistant', content: 'Response 2', timestamp: new Date(), tokens: undefined },
      { role: 'user', content: 'Last message', timestamp: new Date(), tokens: undefined },
    ];
    
    const result = await manager.compressHistory(messages, '');
    
    // Should keep first and last
    expect(result.messages[0].content).toBe('First message');
    expect(result.messages[result.messages.length - 1].content).toBe('Last message');
  });
  
  it('should handle empty history', async () => {
    const manager = new ContextManager();
    const result = await manager.compressHistory([], 'System prompt');
    
    expect(result.messages).toHaveLength(0);
    expect(result.compressionRatio).toBe(1);
  });
  
  it('should not compress when under limit', async () => {
    const manager = new ContextManager({
      maxContextTokens: 10000,
      reservedTokens: 1000
    });
    
    const messages: Message[] = [
      { role: 'user', content: 'Short message', timestamp: new Date(), tokens: undefined },
      { role: 'assistant', content: 'Short response', timestamp: new Date(), tokens: undefined },
    ];
    
    const result = await manager.compressHistory(messages, 'System');
    
    expect(result.messages).toHaveLength(2);
    expect(result.compressionRatio).toBe(1);
    expect(result.removedMessages).toBe(0);
  });
});

describe('ModelRouter', () => {
  it('should select local model for cost priority', () => {
    const router = new ModelRouter();
    
    const task = {
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 500,
      needsTools: true,
      needsVision: false,
      priority: 'cost' as const
    };
    
    const selection = router.selectModel(task);
    
    // Should select a local model for cost savings
    expect(selection.modelId).toMatch(/^ollama\//);
    expect(selection.estimatedCost).toBe(0);
  });
  
  it('should throw when no suitable model found', () => {
    const router = new ModelRouter();
    
    const task = {
      estimatedInputTokens: 1000000, // Too large for any model
      estimatedOutputTokens: 500,
      needsTools: false,
      needsVision: false,
      priority: 'cost' as const
    };
    
    expect(() => router.selectModel(task)).toThrow('No suitable model found');
  });
});