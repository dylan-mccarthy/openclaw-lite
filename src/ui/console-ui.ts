import readline from 'readline/promises';
import chalk from 'chalk';
import { OllamaIntegration } from '../ollama/integration.js';
import { FileLoader } from '../identity/file-loader.js';
import { initializeConfigSync } from '../config/openclaw-lite-config.js';
import { buildLiteSystemPrompt } from '../agent/system-prompt-lite.js';
import { defaultToolDescriptions } from '../agent/basic-prompt.js';
import type { Message } from '../context/types.js';

export interface ConsoleUIOptions {
  ollamaUrl?: string;
  model?: string;
  maxContextTokens?: number;
  showTimestamps?: boolean;
  showTokens?: boolean;
  logFile?: string;
  systemPrompt?: string;
}

export class ConsoleUI {
  private integration: OllamaIntegration;
  private fileLoader: FileLoader;
  // private contextManager: ContextManager; // Not used yet but kept for future
  private history: Message[] = [];
  private options: ConsoleUIOptions & {
    ollamaUrl: string;
    model: string;
    maxContextTokens: number;
    showTimestamps: boolean;
    showTokens: boolean;
    logFile?: string;
    systemPrompt: string;
  };
  private rl: readline.Interface;
  private logStream: NodeJS.WriteStream | null = null;
  
  constructor(options: ConsoleUIOptions = {}) {
    this.options = {
      ollamaUrl: 'http://localhost:11434',
      model: 'llama3.1:8b',
      maxContextTokens: 8192,
      showTimestamps: false,
      showTokens: true,
      logFile: options.logFile || undefined,
      systemPrompt: '', // Will be loaded from files
      ...options
    };
    
    this.integration = new OllamaIntegration({
      ollama: {
        baseUrl: this.options.ollamaUrl,
        model: this.options.model
      },
      context: {
        maxContextTokens: this.options.maxContextTokens
      }
    });
    
    let workspacePath = process.env.OPENCLAW_WORKSPACE || process.cwd();
    let identityPath: string | undefined;
    let memoryPath: string | undefined;
    try {
      const configManager = initializeConfigSync();
      workspacePath = configManager.getWorkspacePath();
      identityPath = configManager.getIdentityPath();
      memoryPath = configManager.getMemoryPath();
    } catch (error) {
      console.warn('Could not load config, using environment workspace path:', error);
    }

    this.fileLoader = new FileLoader({
      workspacePath,
      identityPath,
      memoryPath
    });
    
    // this.contextManager = new ContextManager({
    //   maxContextTokens: this.options.maxContextTokens
    // });
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });
    
    // Setup log file if specified
    if (this.options.logFile) {
      const fs = require('fs');
      const path = require('path');
      const logDir = path.dirname(this.options.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.logStream = fs.createWriteStream(this.options.logFile, { flags: 'a' });
      this.log(`=== OpenClaw Lite Console Started at ${new Date().toISOString()} ===\n`);
    }
  }
  
  private log(message: string) {
    if (this.logStream) {
      this.logStream.write(message + '\n');
    }
  }
  
  async start() {
    console.clear();
    this.printHeader();
    await this.checkEncryption();
    await this.loadIdentity();
    await this.checkOllama();
    await this.mainLoop();
  }
  
  private printHeader() {
    const header = `
${chalk.bold.cyan('╔══════════════════════════════════════════════════════════╗')}
${chalk.bold.cyan('║')}  ${chalk.bold.white('OPENCLAW LITE')} ${chalk.gray('•')} ${chalk.yellow('Console UI')} ${chalk.gray('•')} ${chalk.green('v0.1.0')}  ${chalk.bold.cyan('║')}
${chalk.bold.cyan('╠══════════════════════════════════════════════════════════╣')}
${chalk.bold.cyan('║')}  ${chalk.gray('Model:')} ${chalk.green(this.options.model)}  ${chalk.gray('•')}  ${chalk.gray('Context:')} ${chalk.yellow(this.options.maxContextTokens.toLocaleString())} tokens  ${chalk.bold.cyan('║')}
${chalk.bold.cyan('║')}  ${chalk.gray('URL:')} ${chalk.blue(this.options.ollamaUrl)}                          ${chalk.bold.cyan('║')}
${chalk.bold.cyan('╚══════════════════════════════════════════════════════════╝')}

${chalk.gray('Type your message or use commands:')}
${chalk.cyan('/help')} ${chalk.gray('- Show commands')}    ${chalk.cyan('/clear')} ${chalk.gray('- Clear history')}
${chalk.cyan('/model')} ${chalk.gray('- Change model')}    ${chalk.cyan('/stats')} ${chalk.gray('- Show stats')}
${chalk.cyan('/exit')} ${chalk.gray('- Quit')}           ${chalk.cyan('/logs')} ${chalk.gray('- Toggle logs')}

${chalk.gray('─'.repeat(60))}
`;
    
    console.log(header);
  }
  
  private async checkEncryption() {
    process.stdout.write(chalk.gray('🔐 Checking encryption... '));
    
    try {
      if (this.fileLoader.isEncryptionAvailable()) {
        console.log(chalk.green('✅ Available\n'));
        console.log(chalk.gray('   Sensitive files will be encrypted at rest'));
        await this.fileLoader.ensureEncryptedFiles();
      } else {
        console.log(chalk.yellow('⚠️  Not configured\n'));
        console.log(chalk.gray('   Run `scripts/secure-install.sh` to enable encryption'));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️  Failed\n'));
      console.log(chalk.gray(`   ${error instanceof Error ? error.message : String(error)}`));
    }
    
    console.log(chalk.gray('─'.repeat(60)));
  }
  
  private async loadIdentity() {
    process.stdout.write(chalk.gray('📚 Loading identity files... '));
    
    try {
      const identityPrompt = await this.fileLoader.buildIdentityPrompt();
      const toolSummaries = defaultToolDescriptions.map(tool => ({
        name: tool.name,
        summary: tool.description,
      }));

      this.options.systemPrompt = buildLiteSystemPrompt({
        workspaceDir: process.cwd(),
        systemBase: identityPrompt,
        toolSummaries,
        runtimeInfo: {
          model: this.options.model,
          os: `${process.platform} ${process.arch}`,
          node: process.version,
        },
        maxContextTokens: this.options.maxContextTokens,
        reservedTokens: 1000,
      });
      console.log(chalk.green('✅ Loaded\n'));
      
      const identity = await this.fileLoader.loadIdentity();
      if (identity.soul) {
        const soulPreview = identity.soul.substring(0, 80) + (identity.soul.length > 80 ? '...' : '');
        console.log(chalk.gray(`   SOUL.md: ${soulPreview}`));
      }
      if (identity.user) {
        console.log(chalk.gray(`   USER.md: Loaded (${identity.user.length} chars)`));
      }
      if (identity.memory && identity.memory.length > 0) {
        console.log(chalk.gray(`   Memory: ${identity.memory.length} entries`));
      }
      
    } catch (error) {
      console.log(chalk.yellow('⚠️  Could not load\n'));
      console.log(chalk.yellow(`   ${error instanceof Error ? error.message : String(error)}`));
      console.log(chalk.gray('   Using default system prompt'));
      this.options.systemPrompt = this.options.systemPrompt || 'You are a helpful AI assistant.';
    }
    
    console.log(chalk.gray('─'.repeat(60)));
  }
  
  private async checkOllama() {
    process.stdout.write(chalk.gray('🔍 Checking Ollama... '));
    
    try {
      const health = await this.integration.healthCheck();
      
      if (health.ollama) {
        console.log(chalk.green('✅ Connected\n'));
        console.log(chalk.gray(`   Available models: ${health.models.length}`));
        if (health.models.includes(this.options.model.replace('ollama/', ''))) {
          console.log(chalk.green(`   ✓ Using: ${this.options.model}`));
        } else {
          console.log(chalk.yellow(`   ⚠️  Model not found, using default`));
        }
      } else {
        console.log(chalk.red('❌ Not connected\n'));
        console.log(chalk.yellow('   Make sure Ollama is running:'));
        console.log(chalk.gray('   $ ollama serve'));
        console.log(chalk.gray(`   URL: ${this.options.ollamaUrl}`));
      }
    } catch (error) {
      console.log(chalk.red('❌ Error\n'));
      console.log(chalk.yellow(`   ${error instanceof Error ? error.message : String(error)}`));
    }
    
    console.log('\n' + chalk.gray('─'.repeat(60)));
  }
  
  private async mainLoop() {
    while (true) {
      try {
        const input = await this.rl.question(chalk.blue('You: '));
        
        if (input.trim() === '') continue;
        
        // Check for commands
        if (input.startsWith('/')) {
          await this.handleCommand(input);
          continue;
        }
        
        // Handle exit
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          console.log(chalk.gray('\n👋 Goodbye!'));
          break;
        }
        
        // Process user message
        await this.processMessage(input);
        
      } catch (error) {
        console.log(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    
    this.cleanup();
  }
  
  private async processMessage(userInput: string) {
    const userMessage: Message = {
      role: 'user',
      content: userInput,
      timestamp: new Date()
    };
    
    // Add to history
    this.history.push(userMessage);
    this.log(`[USER] ${userInput}`);
    
    // Show thinking indicator
    process.stdout.write(chalk.gray('🤔 Thinking... '));
    
    try {
      const startTime = Date.now();
      
      // Get response
      const result = await this.integration.complete(
        this.history,
        this.options.systemPrompt
      );
      
      const responseTime = Date.now() - startTime;
      
      // Clear thinking indicator
      process.stdout.write('\r' + ' '.repeat(50) + '\r');
      
      // Add assistant response to history
      const assistantMessage: Message = {
        role: 'assistant',
        content: result.response,
        timestamp: new Date()
      };
      
      this.history.push(assistantMessage);
      this.log(`[ASSISTANT] ${result.response}`);
      
      // Display response
      console.log(chalk.green(`\nAda: ${result.response}\n`));
      
      // Show stats if enabled
      if (this.options.showTokens) {
        const stats = [
          chalk.gray(`⏱️  ${responseTime}ms`),
          chalk.gray(`📊 ${result.tokens.input}+${result.tokens.output} tokens`),
          chalk.gray(`🧠 ${result.context.compressedMessages}/${result.context.originalMessages} msgs`)
        ];
        
        if (result.context.compressionRatio < 1) {
          stats.push(chalk.yellow(`📉 ${((1 - result.context.compressionRatio) * 100).toFixed(1)}% compressed`));
        }
        
        console.log(chalk.gray('   ' + stats.join(' • ') + '\n'));
      }
      
      // Show context warning if compression was heavy
      if (result.context.compressionRatio < 0.7) {
        console.log(chalk.yellow(`   ⚠️  Heavy compression (${((1 - result.context.compressionRatio) * 100).toFixed(1)}%) - consider /clear\n`));
      }
      
    } catch (error) {
      process.stdout.write('\r' + ' '.repeat(50) + '\r');
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\n❌ Error: ${errorMessage}\n`));
      this.log(`[ERROR] ${errorMessage}`);
    }
  }
  
  private async handleCommand(command: string) {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    
    switch (cmd) {
      case '/help':
        this.printHelp();
        break;
        
      case '/clear':
        this.history = [];
        console.log(chalk.green('✅ History cleared\n'));
        this.log('[SYSTEM] History cleared');
        break;
        
      case '/model':
        if (parts.length > 1) {
          const newModel = parts[1];
          this.options.model = newModel;
          this.integration.updateOllamaConfig({ model: newModel });
          console.log(chalk.green(`✅ Model changed to: ${newModel}\n`));
          this.log(`[SYSTEM] Model changed to ${newModel}`);
        } else {
          console.log(chalk.yellow('Usage: /model <model-name>\n'));
        }
        break;
        
      case '/stats':
        this.printStats();
        break;
        
      case '/logs':
        this.options.showTokens = !this.options.showTokens;
        console.log(chalk.green(`✅ Token stats: ${this.options.showTokens ? 'ON' : 'OFF'}\n`));
        break;
        
      case '/exit':
        console.log(chalk.gray('\n👋 Goodbye!'));
        this.cleanup();
        process.exit(0);
        break;
        
      default:
        console.log(chalk.yellow(`❓ Unknown command: ${cmd}\n`));
        break;
    }
  }
  
  private printHelp() {
    const help = `
${chalk.bold.cyan('Available Commands:')}

${chalk.cyan('/help')}          - Show this help
${chalk.cyan('/clear')}         - Clear conversation history
${chalk.cyan('/model <name>')}  - Change model (e.g., /model qwen2.5-coder:7b)
${chalk.cyan('/stats')}         - Show conversation statistics
${chalk.cyan('/logs')}          - Toggle token/log display
${chalk.cyan('/exit')}          - Quit the application

${chalk.bold.cyan('Keyboard Shortcuts:')}
${chalk.gray('Ctrl+C')}         - Exit
${chalk.gray('Ctrl+L')}         - Clear screen
${chalk.gray('↑/↓')}            - Navigate history

${chalk.bold.cyan('Current Settings:')}
  Model: ${chalk.green(this.options.model)}
  Context: ${chalk.yellow(this.options.maxContextTokens.toLocaleString())} tokens
  URL: ${chalk.blue(this.options.ollamaUrl)}
  Logs: ${this.options.logFile ? chalk.green(this.options.logFile) : chalk.gray('disabled')}
`;
    
    console.log(help);
  }
  
  private printStats() {
    const userMessages = this.history.filter(m => m.role === 'user').length;
    const assistantMessages = this.history.filter(m => m.role === 'assistant').length;
    
    // Estimate tokens
    const totalChars = this.history.reduce((sum, msg) => sum + msg.content.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);
    
    const stats = `
${chalk.bold.cyan('Conversation Statistics:')}

${chalk.gray('Messages:')} ${chalk.yellow(this.history.length)} total
  ${chalk.gray('•')} ${chalk.blue(userMessages)} user messages
  ${chalk.gray('•')} ${chalk.green(assistantMessages)} assistant messages

${chalk.gray('Tokens (estimated):')} ${chalk.yellow(estimatedTokens.toLocaleString())}
${chalk.gray('Characters:')} ${chalk.yellow(totalChars.toLocaleString())}

${chalk.gray('Context usage:')} ${chalk.yellow(estimatedTokens)} / ${chalk.yellow(this.options.maxContextTokens)} tokens
${chalk.gray('Usage:')} ${chalk.yellow(((estimatedTokens / this.options.maxContextTokens) * 100).toFixed(1))}%

${chalk.gray('Model:')} ${chalk.green(this.options.model)}
${chalk.gray('Ollama URL:')} ${chalk.blue(this.options.ollamaUrl)}
`;
    
    console.log(stats);
  }
  
  private cleanup() {
    this.rl.close();
    if (this.logStream) {
      this.logStream.end();
    }
  }
}

// Export a simple start function
export async function startConsoleUI(options: ConsoleUIOptions = {}) {
  const ui = new ConsoleUI(options);
  await ui.start();
}