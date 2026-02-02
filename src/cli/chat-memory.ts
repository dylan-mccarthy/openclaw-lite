import chalk from 'chalk';
import ora from 'ora';
import { OllamaIntegration } from '../ollama/integration.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { getConfigManager } from '../config/config.js';
import type { Message } from '../context/types.js';

export async function startInteractiveChat(options: {
  url: string;
  model: string;
  systemPrompt?: string;
  maxContextTokens: number;
  saveSession?: boolean;
  sessionId?: string;
}) {
  console.log(chalk.bold('💬 Interactive Chat with Ollama'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(`Model: ${chalk.green(options.model)}`);
  console.log(`URL: ${chalk.cyan(options.url)}`);
  
  // Setup memory if enabled
  let memoryManager: MemoryManager | null = null;
  let currentSessionId: string = options.sessionId || '';
  const configManager = getConfigManager();
  const config = configManager.getConfig();
  
  if (options.saveSession && config.memory.enabled) {
    memoryManager = new MemoryManager({
      storagePath: config.memory.storagePath,
      maxSessions: config.memory.maxSessions,
      pruneDays: config.memory.pruneDays,
    });
    
    if (options.sessionId) {
      // Load existing session
      const session = memoryManager.loadSession(options.sessionId);
      if (session) {
        console.log(chalk.green(`📂 Loaded session: ${session.metadata.name}`));
        console.log(chalk.gray(`${session.messages.length} messages, ${session.metadata.totalTokens.toLocaleString()} tokens`));
        currentSessionId = options.sessionId;
      } else {
        console.log(chalk.yellow(`⚠️  Session ${options.sessionId} not found, starting new session`));
        currentSessionId = memoryManager.generateSessionId();
      }
    } else {
      // Create new session
      currentSessionId = memoryManager.generateSessionId();
    }
    
    console.log(chalk.cyan(`💾 Session ID: ${currentSessionId}`));
  } else if (options.saveSession && !config.memory.enabled) {
    console.log(chalk.yellow('⚠️  Memory system is disabled. Enable it with:'));
    console.log(chalk.cyan('  claw-lite config --update memory.enabled=true'));
    console.log(chalk.gray('Session will not be saved.'));
  }
  
  console.log(chalk.gray('Type "exit" or "quit" to end the chat'));
  console.log(chalk.gray('Type "/save" to save session manually'));
  console.log(chalk.gray('Type "/stats" to see session statistics\n'));
  
  const integration = new OllamaIntegration({
    ollama: {
      baseUrl: options.url,
      model: options.model,
    },
    context: {
      maxContextTokens: options.maxContextTokens,
    },
  });
  
  let history: Message[] = [];
  const systemPrompt = options.systemPrompt || 'You are a helpful AI assistant.';
  
  // Load existing session if specified
  if (memoryManager && options.sessionId) {
    const session = memoryManager.loadSession(options.sessionId);
    if (session) {
      history = session.messages;
    }
  }
  
  // Check Ollama health first
  const spinner = ora('Checking Ollama...').start();
  try {
    const health = await integration.healthCheck();
    if (!health.ollama) {
      spinner.fail('Ollama is not running');
      console.log(chalk.yellow('\nStart Ollama with:'));
      console.log(chalk.gray('  $ ollama serve'));
      process.exit(1);
    }
    spinner.succeed(`Connected to Ollama (${health.models.length} models available)`);
  } catch (error) {
    spinner.fail('Cannot connect to Ollama');
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  
  // Interactive loop
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  try {
    while (true) {
      const userInput = await rl.question(chalk.blue('You: '));
      
      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        // Save session before exit if enabled
        if (memoryManager && currentSessionId && history.length > 0) {
          const spinner = ora('Saving session...').start();
          memoryManager.saveSession(currentSessionId, history, {
            name: `Chat ${new Date().toLocaleString()}`,
            tags: ['interactive', 'chat'],
          });
          spinner.succeed(`Session saved: ${currentSessionId}`);
        }
        
        console.log(chalk.gray('\nGoodbye! 👋'));
        break;
      }
      
      if (userInput.trim() === '') {
        continue;
      }
      
      // Handle commands
      if (userInput.startsWith('/')) {
        const command = userInput.substring(1).toLowerCase().trim();
        
        if (command === 'save' && memoryManager) {
          if (currentSessionId && history.length > 0) {
            const spinner = ora('Saving session...').start();
            memoryManager.saveSession(currentSessionId, history, {
              name: `Chat ${new Date().toLocaleString()}`,
              tags: ['interactive', 'chat', 'manual-save'],
            });
            spinner.succeed(`Session saved: ${currentSessionId}`);
          } else {
            console.log(chalk.yellow('⚠️  No session to save'));
          }
          continue;
        }
        
        if (command === 'stats') {
          console.log(chalk.gray('\n📊 Session Statistics'));
          console.log(chalk.gray('─'.repeat(40)));
          console.log(`Messages: ${history.length}`);
          const totalTokens = history.reduce((sum, msg) => sum + (msg.tokens || 0), 0);
          console.log(`Tokens: ${totalTokens.toLocaleString()}`);
          
          if (memoryManager && currentSessionId) {
            const session = memoryManager.loadSession(currentSessionId);
            if (session) {
              console.log(`Session: ${session.metadata.name}`);
              console.log(`Created: ${new Date(session.metadata.createdAt).toLocaleString()}`);
              console.log(`Tags: ${session.metadata.tags.join(', ') || 'none'}`);
            }
          }
          console.log();
          continue;
        }
        
        if (command === 'help') {
          console.log(chalk.gray('\n💡 Available Commands:'));
          console.log(chalk.gray('─'.repeat(40)));
          console.log(chalk.cyan('/save') + ' - Save current session to memory');
          console.log(chalk.cyan('/stats') + ' - Show session statistics');
          console.log(chalk.cyan('/help') + ' - Show this help');
          console.log(chalk.cyan('exit') + ' or ' + chalk.cyan('quit') + ' - End chat');
          console.log();
          continue;
        }
        
        console.log(chalk.yellow(`⚠️  Unknown command: ${command}`));
        console.log(chalk.gray('Type /help for available commands\n'));
        continue;
      }
      
      const spinner = ora('Thinking...').start();
      
      try {
        const result = await integration.complete(
          [...history, { role: 'user', content: userInput, timestamp: new Date() }],
          systemPrompt
        );
        
        spinner.succeed('Response ready');
        
        console.log(chalk.green(`\nAssistant: ${result.response}\n`));
        
        // Add to history
        const userMessage: Message = { 
          role: 'user', 
          content: userInput, 
          timestamp: new Date(),
          tokens: result.tokens.input // This is approximate
        };
        
        const assistantMessage: Message = { 
          role: 'assistant', 
          content: result.response, 
          timestamp: new Date(),
          tokens: result.tokens.output
        };
        
        history.push(userMessage, assistantMessage);
        
        // Show context info
        console.log(chalk.gray(`Context: ${result.context.compressedMessages}/${result.context.originalMessages} messages (${(result.context.compressionRatio * 100).toFixed(1)}% kept)`));
        console.log(chalk.gray(`Tokens: ${result.tokens.input} in, ${result.tokens.output} out`));
        console.log(chalk.gray(`Model: ${result.modelUsed}\n`));
        
      } catch (error) {
        spinner.fail('Error generating response');
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
        console.log(chalk.yellow('Try again or type "exit" to quit.\n'));
      }
    }
  } finally {
    rl.close();
  }
}