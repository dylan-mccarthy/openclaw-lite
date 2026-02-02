#!/usr/bin/env node

import { ContextManager } from '../dist/context/context-manager.js';
import { ModelRouter } from '../dist/context/model-router.js';
import { TokenEstimator } from '../dist/context/token-estimator.js';

async function main() {
  console.log('🚀 OpenClaw Lite - Basic Usage Example\n');

// Example 1: Context Management
console.log('1. 📚 Context Management Example');
console.log('─'.repeat(50));

const manager = new ContextManager({
  maxContextTokens: 4000,
  reservedTokens: 1000,
  compressionStrategy: 'hybrid',
  keepFirstLast: true
});

// Create a sample conversation
const conversation = [
  { role: 'system', content: 'You are a helpful assistant.', timestamp: new Date() },
  { role: 'user', content: 'Hello! Can you help me with programming?', timestamp: new Date() },
  { role: 'assistant', content: 'Sure! What language are you working with?', timestamp: new Date() },
  { role: 'user', content: 'TypeScript. I need to create a function that...', timestamp: new Date() },
  { role: 'assistant', content: 'Here\'s a TypeScript function template...', timestamp: new Date() },
  { role: 'user', content: 'Thanks! Now about error handling...', timestamp: new Date() },
  { role: 'assistant', content: 'Error handling in TypeScript...', timestamp: new Date() },
  { role: 'user', content: 'What about async/await patterns?', timestamp: new Date() },
  { role: 'assistant', content: 'Async/await patterns...', timestamp: new Date() },
  { role: 'user', content: 'And testing frameworks?', timestamp: new Date() },
  { role: 'assistant', content: 'Testing frameworks...', timestamp: new Date() },
  { role: 'user', content: 'Final question: deployment strategies?', timestamp: new Date() },
];

const result = await manager.compressHistory(conversation, 'System: Be helpful and concise.');
console.log(`Original: ${conversation.length} messages`);
console.log(`Compressed: ${result.messages.length} messages`);
console.log(`Removed: ${result.removedMessages} messages`);
console.log(`Compression ratio: ${(result.compressionRatio * 100).toFixed(1)}%`);
console.log(`Strategy: ${result.strategyUsed}\n`);

// Example 2: Model Selection
console.log('2. 🤖 Model Selection Example');
console.log('─'.repeat(50));

const router = new ModelRouter();

const codingTask = {
  estimatedInputTokens: 3500,
  estimatedOutputTokens: 1500,
  needsTools: true,
  needsVision: false,
  priority: 'local'
};

const codingSelection = router.selectModel(codingTask);
console.log(`Task: Coding assistance (${codingTask.estimatedInputTokens} input tokens)`);
console.log(`Selected: ${codingSelection.modelId}`);
console.log(`Reason: ${codingSelection.reason}`);
console.log(`Cost: ${codingSelection.estimatedCost === 0 ? 'FREE (local)' : `$${codingSelection.estimatedCost}`}\n`);

const researchTask = {
  estimatedInputTokens: 10000,
  estimatedOutputTokens: 3000,
  needsTools: false,
  needsVision: false,
  priority: 'quality'
};

const researchSelection = router.selectModel(researchTask);
console.log(`Task: Research (${researchTask.estimatedInputTokens} input tokens)`);
console.log(`Selected: ${researchSelection.modelId}`);
console.log(`Reason: ${researchSelection.reason}`);
console.log(`Cost: ${researchSelection.estimatedCost === 0 ? 'FREE (local)' : `$${researchSelection.estimatedCost}`}\n`);

// Example 3: Token Estimation
console.log('3. 🔤 Token Estimation Example');
console.log('─'.repeat(50));

const estimator = TokenEstimator.createForModel('ollama/qwen2.5-coder:7b');

const codeSnippet = `function calculateFibonacci(n: number): number {
  if (n <= 1) return n;
  return calculateFibonacci(n - 1) + calculateFibonacci(n - 2);
}

// Test the function
console.log(calculateFibonacci(10)); // Should output 55`;

const tokens = estimator.estimate(codeSnippet);
console.log(`Code snippet length: ${codeSnippet.length} characters`);
console.log(`Estimated tokens: ${tokens}`);
console.log(`Characters per token: ${(codeSnippet.length / tokens).toFixed(2)}`);
console.log(`Model: ollama/qwen2.5-coder:7b\n`);

// Example 4: Integration Scenario
console.log('4. 🔄 Complete Integration Scenario');
console.log('─'.repeat(50));

console.log('Scenario: Long conversation with local LLM');
console.log('Step 1: Analyze conversation length');

const longConversation = Array.from({ length: 30 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `Message ${i + 1}: ${'x'.repeat(100)}`,
  timestamp: new Date(Date.now() - i * 60000)
}));

const totalTokens = longConversation.reduce((sum, msg) => 
  sum + estimator.estimate(msg.content), 0);

console.log(`Conversation: 30 messages, ~${totalTokens} tokens`);

console.log('\nStep 2: Select appropriate model');
const scenarioTask = {
  estimatedInputTokens: totalTokens,
  estimatedOutputTokens: 1000,
  needsTools: false,
  needsVision: false,
  priority: 'cost'
};

try {
  const scenarioModel = router.selectModel(scenarioTask);
  console.log(`Selected model: ${scenarioModel.modelId}`);
  console.log(`Context window: ${scenarioModel.contextWindow} tokens`);
  
  console.log('\nStep 3: Compress if needed');
  if (totalTokens > scenarioModel.contextWindow * 0.8) {
    console.log('⚠️  Conversation too long, compressing...');
    const compressed = manager.compressHistory(
      longConversation,
      'System prompt',
      scenarioModel.modelId
    );
    console.log(`Compressed to ${compressed.messages.length} messages`);
    console.log(`Token reduction: ${((1 - compressed.compressionRatio) * 100).toFixed(1)}%`);
  } else {
    console.log('✅ Conversation fits within model context');
  }
} catch (error) {
  console.log(`❌ No suitable model: ${error.message}`);
}

  console.log('\n' + '='.repeat(50));
  console.log('✅ OpenClaw Lite is ready for local LLM optimization!');
  console.log('Use \'claw-lite\' command for more features.');
}

main().catch(console.error);