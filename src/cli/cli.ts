#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import { ContextManager } from '../context/context-manager.js';
import { ModelRouter } from '../context/model-router.js';
import { TokenEstimator } from '../context/token-estimator.js';
import { OllamaIntegration } from '../ollama/integration.js';
import { initializeConfig } from '../config/openclaw-lite-config.js';
import { join, basename } from 'path';
import type { Message } from '../context/types.js';

const program = new Command();

program
  .name('claw-lite')
  .description('OpenClaw Lite - Minimal AI agent for local LLMs')
  .version('0.1.0');

// Context management commands
program
  .command('context')
  .description('Manage conversation context')
  .option('-m, --max-tokens <number>', 'Maximum context tokens', '8192')
  .option('-s, --strategy <type>', 'Compression strategy (truncate|selective|hybrid)', 'hybrid')
  .option('-f, --file <path>', 'Load conversation from JSON file')
  .action(async (options) => {
    const spinner = ora('Initializing context manager...').start();
    
    try {
      const manager = new ContextManager({
        maxContextTokens: parseInt(options.maxTokens),
        compressionStrategy: options.strategy as any
      });
      
      let messages: Message[] = [];
      
      if (options.file) {
        // Load from file
        spinner.text = `Loading conversation from ${options.file}...`;
        const data = await import(options.file, { assert: { type: 'json' } });
        messages = data.default || data;
      } else {
        // Create sample conversation
        spinner.text = 'Creating sample conversation...';
        messages = createSampleConversation();
      }
      
      spinner.text = 'Compressing context...';
      const result = await manager.compressHistory(messages, 'You are a helpful AI assistant.');
      
      spinner.succeed('Context compression complete!');
      
      console.log('\n' + chalk.bold('📊 Compression Results:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Original messages: ${chalk.yellow(messages.length)}`);
      console.log(`Compressed messages: ${chalk.green(result.messages.length)}`);
      console.log(`Removed messages: ${chalk.red(result.removedMessages)}`);
      console.log(`Original tokens: ${chalk.yellow(result.originalTokenCount.toLocaleString())}`);
      console.log(`Compressed tokens: ${chalk.green(result.compressedTokenCount.toLocaleString())}`);
      console.log(`Compression ratio: ${chalk.blue((result.compressionRatio * 100).toFixed(1))}%`);
      console.log(`Strategy used: ${chalk.cyan(result.strategyUsed)}`);
      
      console.log('\n' + chalk.bold('📝 Kept Messages:'));
      result.messages.forEach((msg) => {
        const roleColor = msg.role === 'user' ? chalk.blue : 
                         msg.role === 'assistant' ? chalk.green : chalk.magenta;
        const preview = msg.content.length > 60 
          ? msg.content.substring(0, 57) + '...' 
          : msg.content;
        console.log(`  ${roleColor(`[${msg.role}]`)} ${preview}`);
      });
      
    } catch (error) {
      spinner.fail('Error processing context');
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Model routing commands
program
  .command('model')
  .description('Select appropriate model for a task')
  .option('-i, --input-tokens <number>', 'Estimated input tokens', '1000')
  .option('-o, --output-tokens <number>', 'Estimated output tokens', '500')
  .option('-t, --needs-tools', 'Task requires tool usage', false)
  .option('-v, --needs-vision', 'Task requires vision capabilities', false)
  .option('-p, --priority <type>', 'Priority (local|cost|speed|quality)', 'cost')
  .action(async (options) => {
    const spinner = ora('Analyzing task requirements...').start();
    
    try {
      const router = new ModelRouter();
      
      const task = {
        estimatedInputTokens: parseInt(options.inputTokens),
        estimatedOutputTokens: parseInt(options.outputTokens),
        needsTools: options.needsTools,
        needsVision: options.needsVision,
        priority: options.priority as any
      };
      
      spinner.text = 'Selecting optimal model...';
      const selection = router.selectModel(task);
      
      spinner.succeed('Model selection complete!');
      
      console.log('\n' + chalk.bold('🤖 Model Selection:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Selected model: ${chalk.green(selection.modelId)}`);
      console.log(`Reason: ${chalk.cyan(selection.reason)}`);
      console.log(`Context window: ${chalk.yellow(selection.contextWindow.toLocaleString())} tokens`);
      
      if (selection.estimatedCost !== undefined) {
        if (selection.estimatedCost === 0) {
          console.log(`Estimated cost: ${chalk.green('FREE (local model)')}`);
        } else {
          console.log(`Estimated cost: ${chalk.yellow(`$${selection.estimatedCost.toFixed(6)}`)}`);
        }
      }
      
      console.log('\n' + chalk.bold('📋 Available Models:'));
      const models = router.getAvailableModels();
      models.forEach(model => {
        const isSelected = model.id === selection.modelId;
        const prefix = isSelected ? chalk.green('→ ') : '  ';
        const name = isSelected ? chalk.green(model.id) : chalk.gray(model.id);
        const local = model.isLocal ? chalk.blue('[LOCAL]') : chalk.yellow('[CLOUD]');
        const context = chalk.cyan(`${model.contextWindow.toLocaleString()} tokens`);
        
        console.log(`${prefix}${name} ${local} ${context}`);
      });
      
    } catch (error) {
      spinner.fail('Error selecting model');
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Token estimation commands
program
  .command('tokens')
  .description('Estimate tokens in text')
  .argument('<text>', 'Text to analyze')
  .option('-m, --model <id>', 'Model ID for accurate estimation')
  .action((text, options) => {
    const estimator = options.model 
      ? TokenEstimator.createForModel(options.model)
      : new TokenEstimator();
    
    const tokens = estimator.estimate(text);
    const chars = text.length;
    const ratio = chars / tokens;
    
    console.log('\n' + chalk.bold('🔤 Token Analysis:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Text length: ${chalk.yellow(chars.toLocaleString())} characters`);
    console.log(`Estimated tokens: ${chalk.green(tokens.toLocaleString())}`);
    console.log(`Characters per token: ${chalk.cyan(ratio.toFixed(2))}`);
    
    if (options.model) {
      console.log(`Model: ${chalk.magenta(options.model)}`);
    }
    
    // Show preview
    console.log('\n' + chalk.bold('📄 Text Preview:'));
    const preview = text.length > 200 
      ? text.substring(0, 197) + '...' 
      : text;
    console.log(chalk.gray(preview));
  });

// Ollama commands
program
  .command('ollama')
  .description('Interact with Ollama local LLM')
  .option('-u, --url <url>', 'Ollama API URL')
  .option('-m, --model <name>', 'Model to use')
  .option('-t, --temperature <number>', 'Temperature (0-1)')
  .option('--max-tokens <number>', 'Maximum tokens to generate')
  .action(async (options) => {
    const spinner = ora('Connecting to Ollama...').start();
    
    try {
      const configManager = await initializeConfig();
      const config = configManager.getConfig();
      const url = options.url || config.ollama.url;
      const model = options.model || config.ollama.defaultModel;
      const temperature = options.temperature ? parseFloat(options.temperature) : config.ollama.temperature;
      const maxTokens = options.maxTokens ? parseInt(options.maxTokens) : config.ollama.maxTokens;

      const integration = new OllamaIntegration({
        ollama: {
          baseUrl: url,
          model,
          temperature,
          maxTokens,
        },
      });
      
      spinner.text = 'Checking Ollama health...';
      const health = await integration.healthCheck();
      
      if (!health.ollama) {
        spinner.fail('Ollama is not running or inaccessible');
        console.log(chalk.yellow('\nMake sure Ollama is running:'));
        console.log(chalk.gray('  $ ollama serve'));
        console.log(chalk.gray(`  Then access it at: ${options.url}`));
        process.exit(1);
      }
      
      spinner.succeed('Ollama is ready!');
      
      console.log('\n' + chalk.bold('🤖 Ollama Status:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`URL: ${chalk.cyan(url)}`);
      console.log(`Default model: ${chalk.green(model)}`);
      console.log(`Available models: ${chalk.yellow(health.models.length)}`);
      
      if (health.models.length > 0) {
        console.log(chalk.gray('\nInstalled models:'));
        health.models.forEach(modelName => {
          const isDefault = modelName === model;
          const prefix = isDefault ? chalk.green('→ ') : '  ';
          console.log(`${prefix}${modelName}`);
        });
      }
      
      console.log(chalk.gray('\nUse:'));
      console.log(`  ${chalk.cyan('claw-lite ask')} - Ask a question`);
      console.log(`  ${chalk.cyan('claw-lite chat')} - Interactive chat`);
      
    } catch (error) {
      spinner.fail('Error connecting to Ollama');
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('ask')
  .description('Ask Ollama a question')
  .argument('<question>', 'Question to ask')
  .option('-u, --url <url>', 'Ollama API URL')
  .option('-m, --model <name>', 'Model to use')
  .option('-s, --system <prompt>', 'System prompt')
  .option('--max-tokens <number>', 'Maximum response tokens')
  .action(async (question, options) => {
    const spinner = ora('Thinking...').start();
    
    try {
      const configManager = await initializeConfig();
      const config = configManager.getConfig();
      const url = options.url || config.ollama.url;
      const model = options.model || config.ollama.defaultModel;
      const maxTokens = options.maxTokens ? parseInt(options.maxTokens) : Math.min(1024, config.ollama.maxTokens);

      const integration = new OllamaIntegration({
        ollama: {
          baseUrl: url,
          model,
          maxTokens,
        },
      });
      
      const systemPrompt = options.system || 'You are a helpful AI assistant.';
      
      spinner.text = 'Generating response...';
      const result = await integration.simpleComplete(
        question,
        [],
        systemPrompt
      ).catch(error => {
        throw new Error(`Ollama generation failed: ${error.message}`);
      });
      
      spinner.succeed('Response ready!');
      
      console.log('\n' + chalk.bold('💬 Question:'));
      console.log(chalk.blue(question));
      
      console.log('\n' + chalk.bold('🤖 Response:'));
      console.log(chalk.green(result));
      
      console.log(chalk.gray('\n─'.repeat(50)));
      console.log(`Model: ${chalk.cyan(model)}`);
      console.log(`System: ${chalk.magenta(systemPrompt.substring(0, 60) + (systemPrompt.length > 60 ? '...' : ''))}`);
      
    } catch (error) {
      spinner.fail('Error generating response');
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('chat')
  .description('Interactive chat with Ollama')
  .option('-u, --url <url>', 'Ollama API URL')
  .option('-m, --model <name>', 'Model to use')
  .option('-s, --system <prompt>', 'System prompt')
  .option('--max-context <tokens>', 'Maximum context tokens')
  .option('--save', 'Save session to persistent memory')
  .option('--session-id <id>', 'Load existing session from memory')
  .action(async (options) => {
    try {
      const configManager = await initializeConfig();
      const config = configManager.getConfig();
      const url = options.url || config.ollama.url;
      const model = options.model || config.ollama.defaultModel;
      const maxContextTokens = options.maxContext ? parseInt(options.maxContext) : config.web.maxContextTokens;

      const { startInteractiveChat } = await import('./chat-memory.js');
      
      await startInteractiveChat({
        url,
        model,
        systemPrompt: options.system,
        maxContextTokens,
        saveSession: options.save,
        sessionId: options.sessionId,
      });
      
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Console UI command
program
  .command('ui')
  .description('Start console UI (chat + logs focused)')
  .option('-u, --url <url>', 'Ollama API URL')
  .option('-m, --model <name>', 'Model to use')
  .option('-c, --context <tokens>', 'Max context tokens')
  .option('-l, --log <file>', 'Log conversation to file')
  .option('--no-stats', 'Hide token statistics')
  .option('--prompt <text>', 'System prompt for the AI')
  .action(async (options) => {
    console.log(chalk.gray('Starting OpenClaw Lite Console UI...\n'));
    
    try {
      const configManager = await initializeConfig();
      const config = configManager.getConfig();
      const url = options.url || config.ollama.url;
      const model = options.model || config.ollama.defaultModel;
      const maxContextTokens = options.context ? parseInt(options.context) : config.web.maxContextTokens;

      const { startConsoleUI } = await import('../ui/console-ui.js');
      
      await startConsoleUI({
        ollamaUrl: url,
        model,
        maxContextTokens,
        showTokens: options.stats,
        logFile: options.log,
        systemPrompt: options.prompt
      });
      
    } catch (error) {
      console.error(chalk.red('Failed to start UI:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Web UI command
program
  .command('web')
  .description('Start web server with chat interface')
  .option('-p, --port <port>', 'Port to listen on')
  .option('-u, --url <url>', 'Ollama API URL')
  .option('-m, --model <name>', 'Model to use')
  .option('-c, --context <tokens>', 'Max context tokens')
  .option('--no-cors', 'Disable CORS')
  .option('--prompt <text>', 'System prompt for the AI')
  .action(async (options) => {
    console.log(chalk.gray('Starting OpenClaw Lite Web Server...\n'));
    
    try {
      const configManager = await initializeConfig();
      const config = configManager.getConfig();
      const url = options.url || config.ollama.url;
      const model = options.model || config.ollama.defaultModel;
      const port = options.port ? parseInt(options.port) : config.web.port;
      const maxContextTokens = options.context ? parseInt(options.context) : config.web.maxContextTokens;
      const corsFlag = process.argv.includes('--no-cors') ? false : undefined;
      const enableCors = corsFlag ?? config.web.enableCors;

      const { startWebServer } = await import('../web/server.js');
      
      await startWebServer({
        port,
        ollamaUrl: url,
        model,
        maxContextTokens,
        enableCors,
        systemPrompt: options.prompt
      });
      
    } catch (error) {
      console.error(chalk.red('Failed to start web server:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Security command
program
  .command('security')
  .description('Manage encryption for sensitive files')
  .option('-e, --encrypt', 'Encrypt sensitive files in workspace')
  .option('-d, --decrypt', 'Decrypt sensitive files in workspace (to stdout)')
  .option('-s, --status', 'Show encryption status of sensitive files')
  .option('-i, --init', 'Initialize secure storage with new encryption key')
  .action(async (options) => {
    const configManager = await initializeConfig();
    const workspace = configManager.getWorkspacePath();
    const identityPath = configManager.getIdentityPath();
    const memoryPath = configManager.getMemoryPath();
    const { FileLoader } = await import('../identity/file-loader.js');
    const fileLoader = new FileLoader({
      workspacePath: workspace,
      identityPath,
      memoryPath
    });
    
    if (options.init) {
      console.log(chalk.gray('🔐 Initializing secure storage...'));
      const { SecureKeyManager } = await import('../security/secure-key-manager.js');
      const keyManager = new SecureKeyManager();
      const success = keyManager.initializeSecureStorage();
      
      if (success) {
        console.log(chalk.green('✅ Secure storage initialized'));
        console.log(chalk.gray('   Key stored in: ~/.openclaw-lite/secure/encryption.key'));
        console.log(chalk.gray('   Use `claw-lite security --encrypt` to encrypt files'));
      } else {
        console.log(chalk.red('❌ Failed to initialize secure storage'));
      }
      return;
    }
    
    if (options.encrypt) {
      if (!fileLoader.isEncryptionAvailable()) {
        console.log(chalk.yellow('⚠️  Encryption not available.'));
        console.log(chalk.gray('   Run `claw-lite security --init` first to create secure storage.'));
        return;
      }
      
      console.log(chalk.gray('🔐 Encrypting sensitive files...'));
      await fileLoader.ensureEncryptedFiles();
      console.log(chalk.green('✅ Encryption complete'));
      return;
    }
    
    if (options.decrypt) {
      console.log(chalk.yellow('⚠️  Decryption outputs to stdout only (no files written).'));
      console.log(chalk.gray('   This is a safety feature. Use read operations for access.'));
      return;
    }
    
    if (options.status || (!options.encrypt && !options.decrypt && !options.init)) {
      const { SecureKeyManager } = await import('../security/secure-key-manager.js');
      const keyManager = new SecureKeyManager();
      const hasSecureStorage = keyManager.isSecureStorageAvailable();
      const hasDirectAccess = keyManager.hasDirectKeyAccess();
      
      console.log(chalk.bold('🔐 Encryption Status'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(`Workspace: ${chalk.cyan(workspace)}`);
      console.log(`Secure storage: ${hasSecureStorage ? chalk.green('AVAILABLE') : chalk.yellow('NOT CONFIGURED')}`);
      console.log(`Key access: ${hasDirectAccess ? chalk.yellow('DIRECT (less secure)') : chalk.green('ISOLATED')}`);
      
      if (fileLoader.isEncryptionAvailable()) {
        console.log(`Encryption: ${chalk.green('ENABLED')}`);
        console.log(chalk.gray('\nSensitive files will be encrypted at rest:'));
        console.log(chalk.gray('  SOUL.md, USER.md, IDENTITY.md, MEMORY.md')); 
        console.log(chalk.gray('  memory/*.md, AGENTS.md, TOOLS.md, HEARTBEAT.md'));
      } else {
        console.log(`Encryption: ${chalk.yellow('NOT AVAILABLE')}`);
        console.log(chalk.gray('\nTo enable encryption:'));
        console.log(chalk.cyan('  claw-lite security --init'));
        console.log(chalk.cyan('  claw-lite security --encrypt'));
      }
      return;
    }
  });

// Identity command
program
  .command('identity')
  .description('Manage identity self-improvement (SOUL.md, USER.md, IDENTITY.md)')
  .option('-u, --update', 'Run identity analysis and apply updates')
  .option('-s, --summary', 'Show current identity summaries')
  .option('-c, --clear-log', 'Clear conversation log used for identity updates')
  .action(async (options) => {
    try {
      const configManager = await initializeConfig();
      const config = configManager.getConfig();
      const workspaceDir = configManager.getWorkspacePath();

      const { OllamaIntegration } = await import('../ollama/integration.js');
      const { IdentityUpdater } = await import('../identity/identity-updater.js');

      const integration = new OllamaIntegration({
        ollama: {
          baseUrl: config.ollama.url,
          model: config.ollama.defaultModel,
        },
        context: {
          maxContextTokens: config.web.maxContextTokens,
        },
      });

      const identityUpdater = new IdentityUpdater(workspaceDir, integration);

      if (options.clearLog) {
        identityUpdater.clearConversationLog();
        console.log(chalk.green('✅ Conversation log cleared'));
        return;
      }

      if (options.update) {
        const result = await identityUpdater.manualUpdate();
        console.log(chalk.green(`✅ ${result.summary}`));
        return;
      }

      const personalityTraits = identityUpdater.getCurrentPersonality();
      const userSummary = identityUpdater.getCurrentUserSummary();
      const identitySummary = identityUpdater.getCurrentIdentitySummary();

      console.log(chalk.bold('🧠 Identity Summary'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.cyan('Personality Traits:'));
      console.log(personalityTraits.length > 0 ? personalityTraits.join(', ') : 'None');
      console.log('\n' + chalk.cyan('USER.md:'));
      console.log(userSummary);
      console.log('\n' + chalk.cyan('IDENTITY.md:'));
      console.log(identitySummary);
    } catch (error) {
      console.error(chalk.red('Failed to manage identity:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Manage OpenClaw Lite configuration')
  .option('-s, --show', 'Show current configuration')
  .option('-u, --update <key=value>', 'Update configuration (e.g., "ollama.defaultModel=huihui_ai/qwen3-abliterated")')
  .option('-r, --reset', 'Reset to default configuration')
  .action(async (options) => {
    const configManager = await initializeConfig();
    const config = configManager.getConfig();
    
    if (options.reset) {
      configManager.resetToDefaults();
      await configManager.save();
      console.log(chalk.green('✅ Configuration reset to defaults'));
      console.log(chalk.gray('\nRun `claw-lite config --show` to see the new configuration'));
      return;
    }
    
    if (options.update) {
      const [path, value] = options.update.split('=');
      if (!path || value === undefined) {
        console.error(chalk.red('❌ Invalid update format. Use: --update key=value'));
        process.exit(1);
      }
      
      // Parse nested path
      const keys = path.split('.');
      let current: any = config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in current)) {
          console.error(chalk.red(`❌ Invalid configuration path: ${path}`));
          process.exit(1);
        }
        current = current[keys[i]];
      }
      
      // Parse value (try JSON, then string)
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }
      
      current[keys[keys.length - 1]] = parsedValue;
      configManager.updateConfig(config);
      await configManager.save();
      
      console.log(chalk.green(`✅ Updated ${path} = ${JSON.stringify(parsedValue)}`));
      return;
    }
    
    if (options.show || (!options.reset && !options.update)) {
      console.log(chalk.bold('📋 OpenClaw Lite Configuration'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(JSON.stringify(config, null, 2));
      console.log(chalk.gray('\nConfig file:'), configManager.getConfigFilePath());
      return;
    }
  });

// Memory commands
program
  .command('memory')
  .description('Manage persistent session memory')
  .option('-l, --list', 'List all saved sessions')
  .option('-s, --stats', 'Show memory statistics')
  .option('-c, --clean', 'Clean up old sessions (prune)')
  .option('-e, --export <path>', 'Export all sessions to JSON file')
  .option('-i, --import <path>', 'Import sessions from JSON file')
  .action(async (options) => {
    const configManager = await initializeConfig();
    const config = configManager.getConfig();
    
    if (!config.memory.enabled) {
      console.log(chalk.yellow('⚠️  Memory system is disabled. Enable it with:'));
      console.log(chalk.cyan('  claw-lite config --update memory.enabled=true'));
      return;
    }
    
    const { MemoryManager } = await import('../memory/memory-manager.js');
    const memoryManager = new MemoryManager({
      storagePath: configManager.getMemoryPath(),
      maxSessions: config.memory.maxSessions,
      pruneDays: config.memory.pruneDays,
    });
    
    if (options.list) {
      const sessions = memoryManager.listSessions({ limit: 20, sortBy: 'lastAccessed', order: 'desc' });
      
      console.log(chalk.bold('💾 Saved Sessions'));
      console.log(chalk.gray('─'.repeat(80)));
      
      if (sessions.length === 0) {
        console.log(chalk.gray('No sessions saved yet.'));
        console.log(chalk.gray('Start a chat with `claw-lite chat --save` to create a session.'));
        return;
      }
      
      sessions.forEach(session => {
        const timeAgo = Math.floor((Date.now() - session.lastAccessed) / (1000 * 60 * 60));
        const timeStr = timeAgo < 24 ? `${timeAgo}h ago` : `${Math.floor(timeAgo / 24)}d ago`;
        
        console.log(`${chalk.green('•')} ${chalk.bold(session.name)}`);
        console.log(`  ${chalk.gray('ID:')} ${session.sessionId}`);
        console.log(`  ${chalk.gray('Messages:')} ${session.messageCount} | ${chalk.gray('Tokens:')} ${session.totalTokens.toLocaleString()}`);
        console.log(`  ${chalk.gray('Last accessed:')} ${timeStr} | ${chalk.gray('Created:')} ${new Date(session.createdAt).toLocaleDateString()}`);
        
        if (session.tags.length > 0) {
          console.log(`  ${chalk.gray('Tags:')} ${session.tags.map(tag => chalk.cyan(tag)).join(', ')}`);
        }
        
        console.log();
      });
      
      const stats = memoryManager.getSessionStats();
      console.log(chalk.gray(`Total: ${stats.totalSessions} sessions, ${stats.totalMessages} messages, ${stats.totalTokens.toLocaleString()} tokens`));
      
    } else if (options.stats) {
      const stats = memoryManager.getSessionStats();
      
      console.log(chalk.bold('📊 Memory Statistics'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(`${chalk.green('Total sessions:')} ${stats.totalSessions}`);
      console.log(`${chalk.green('Total messages:')} ${stats.totalMessages}`);
      console.log(`${chalk.green('Total tokens:')} ${stats.totalTokens.toLocaleString()}`);
      console.log(`${chalk.green('Avg messages/session:')} ${stats.averageMessagesPerSession.toFixed(1)}`);
      
      if (stats.oldestSession) {
        console.log(`${chalk.green('Oldest session:')} ${stats.oldestSession.toLocaleDateString()}`);
      }
      if (stats.newestSession) {
        console.log(`${chalk.green('Newest session:')} ${stats.newestSession.toLocaleDateString()}`);
      }
      
    } else if (options.clean) {
      console.log(chalk.yellow('Cleaning up old sessions...'));
      // Pruning happens automatically, but we can trigger it manually
      const sessionsBefore = memoryManager.listSessions().length;
      const memoryManagerAny = memoryManager as any;
      if (memoryManagerAny.pruneOldSessions) {
        memoryManagerAny.pruneOldSessions();
      }
      const sessionsAfter = memoryManager.listSessions().length;
      
      console.log(chalk.green(`✅ Cleaned up ${sessionsBefore - sessionsAfter} old sessions`));
      console.log(`${sessionsAfter} sessions remaining`);
      
    } else if (options.export) {
      console.log(chalk.yellow(`Exporting sessions to ${options.export}...`));
      memoryManager.exportAllSessions(options.export);
      const stats = memoryManager.getSessionStats();
      console.log(chalk.green(`✅ Exported ${stats.totalSessions} sessions to ${options.export}`));
      
    } else if (options.import) {
      console.log(chalk.yellow(`Importing sessions from ${options.import}...`));
      const count = memoryManager.importSessions(options.import);
      console.log(chalk.green(`✅ Imported ${count} sessions from ${options.import}`));
      
    } else {
      console.log(chalk.bold('💾 Persistent Memory System'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(`Memory is ${config.memory.enabled ? chalk.green('ENABLED') : chalk.yellow('DISABLED')}`);
      console.log(`Storage path: ${chalk.cyan(config.memory.storagePath)}`);
      console.log(`Max sessions: ${chalk.yellow(config.memory.maxSessions)}`);
      console.log(`Prune after: ${chalk.yellow(config.memory.pruneDays)} days`);
      console.log(chalk.gray('\nUsage:'));
      console.log(`  ${chalk.cyan('claw-lite memory --list')} - List saved sessions`);
      console.log(`  ${chalk.cyan('claw-lite memory --stats')} - Show statistics`);
      console.log(`  ${chalk.cyan('claw-lite memory --clean')} - Clean up old sessions`);
      console.log(`  ${chalk.cyan('claw-lite chat --save')} - Save chat sessions`);
    }
  });

// Skills command
program
  .command('skills')
  .description('Manage and verify AI skills')
  .option('-l, --list', 'List installed skills')
  .option('-v, --verify <name>', 'Verify a specific skill')
  .option('-i, --install <path>', 'Install and verify a skill from local path')
  .option('-u, --uninstall <name>', 'Uninstall a skill')
  .option('-s, --scan <path>', 'Scan a skill directory for safety issues')
  .action(async (options) => {
    const configManager = await initializeConfig();
    const workspace = configManager.getWorkspacePath();
    const skillsPath = join(workspace, 'skills');
    const credentialManager = await getCredentialManager();
    
    const { SkillVerifier } = await import('../security/skill-verifier.js');
    const verifier = new SkillVerifier(skillsPath, credentialManager || undefined);
    
    if (options.list) {
      const skills = verifier.listSkills();
      
      console.log(chalk.bold('🧠 Installed Skills'));
      console.log(chalk.gray('─'.repeat(60)));
      
      if (skills.length === 0) {
        console.log(chalk.gray('No skills installed.'));
        console.log(chalk.gray('Install with: claw-lite skills --install <path>'));
        return;
      }
      
      skills.forEach(skill => {
        const verified = skill.verified ? chalk.green('✅') : chalk.yellow('⚠️');
        const date = new Date(skill.installedAt).toLocaleDateString();
        
        console.log(`${verified} ${chalk.bold(skill.name)} v${skill.version}`);
        console.log(`  ${chalk.gray('Hash:')} ${skill.hash.substring(0, 16)}...`);
        console.log(`  ${chalk.gray('Installed:')} ${date}`);
        console.log(`  ${chalk.gray('Verified:')} ${skill.verified ? 'Yes' : 'No'}`);
        console.log();
      });
      return;
    }
    
    if (options.verify) {
      const skillName = options.verify;
      const verified = verifier.verifySkill(skillName);
      
      if (verified) {
        console.log(chalk.green(`✅ Skill "${skillName}" is verified and safe`));
      } else {
        console.log(chalk.red(`❌ Skill "${skillName}" is not verified or failed safety check`));
        console.log(chalk.gray('   Reinstall with: claw-lite skills --install <path>'));
      }
      return;
    }
    
    if (options.install) {
      const sourcePath = options.install;
      const skillName = basename(sourcePath);
      
      console.log(chalk.gray(`📦 Installing skill "${skillName}"...`));
      
      try {
        const result = verifier.installSkill(sourcePath, skillName);
        
        if (result.safe) {
          console.log(chalk.green(`✅ Skill "${skillName}" installed and verified`));
          console.log(chalk.gray(`   Files: ${result.fileCount}`));
          console.log(chalk.gray(`   Hash: ${result.hash}`));
          
          if (result.warnings.length > 0) {
            console.log(chalk.yellow('\n⚠️  Warnings:'));
            result.warnings.forEach(warning => {
              console.log(chalk.gray(`   • ${warning}`));
            });
          }
          
          const installedSkill = verifier.getSkill(skillName);
          if (installedSkill?.credentials && installedSkill.credentials.length > 0) {
            if (!credentialManager) {
              console.log(chalk.yellow('\n⚠️  Secure storage not configured. Run: claw-lite security --init'));
              console.log(chalk.gray('   Credential prompts skipped. Skill may not run without credentials.'));
            } else {
              await configureSkillCredentials(skillName, installedSkill.credentials, credentialManager);
            }
          }
        } else {
          console.log(chalk.red(`❌ Skill "${skillName}" failed safety check`));
          console.log(chalk.yellow('\nIssues found:'));
          result.issues.forEach(issue => {
            console.log(chalk.gray(`   • ${issue}`));
          });
        }
      } catch (error) {
        console.log(chalk.red(`❌ Failed to install skill: ${error instanceof Error ? error.message : String(error)}`));
      }
      return;
    }
    
    if (options.uninstall) {
      const skillName = options.uninstall;
      const success = verifier.uninstallSkill(skillName);
      
      if (success) {
        console.log(chalk.green(`✅ Skill "${skillName}" uninstalled`));
      } else {
        console.log(chalk.red(`❌ Skill "${skillName}" not found or failed to uninstall`));
      }
      return;
    }
    
    if (options.scan) {
      const sourcePath = options.scan;
      const skillName = basename(sourcePath);
      
      console.log(chalk.gray(`🔍 Scanning "${skillName}" for safety issues...`));
      
      try {
        const result = verifier.scanSkillDirectory(sourcePath);
        
        console.log(chalk.bold(`📊 Scan Results for "${skillName}"`));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(`Safety: ${result.safe ? chalk.green('PASS') : chalk.red('FAIL')}`);
        console.log(`Files: ${result.fileCount}`);
        console.log(`Hash: ${result.hash}`);
        
        if (result.issues.length > 0) {
          console.log(chalk.yellow('\n❌ Safety Issues:'));
          result.issues.forEach(issue => {
            console.log(chalk.gray(`   • ${issue}`));
          });
        }
        
        if (result.warnings.length > 0) {
          console.log(chalk.yellow('\n⚠️  Warnings:'));
          result.warnings.forEach(warning => {
            console.log(chalk.gray(`   • ${warning}`));
          });
        }
        
        if (result.safe && result.issues.length === 0) {
          console.log(chalk.green('\n✅ Skill appears safe for installation'));
        } else {
          console.log(chalk.red('\n❌ Skill should not be installed'));
        }
      } catch (error) {
        console.log(chalk.red(`❌ Failed to scan skill: ${error instanceof Error ? error.message : String(error)}`));
      }
      return;
    }
    
    // Default: show help
    console.log(chalk.bold('🧠 Skill Management'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray('Manage AI skills with safety verification'));
    console.log();
    console.log(chalk.cyan('Usage:'));
    console.log(`  ${chalk.cyan('claw-lite skills --list')} - List installed skills`);
    console.log(`  ${chalk.cyan('claw-lite skills --verify <name>')} - Verify a skill`);
    console.log(`  ${chalk.cyan('claw-lite skills --install <path>')} - Install from local path`);
    console.log(`  ${chalk.cyan('claw-lite skills --uninstall <name>')} - Uninstall a skill`);
    console.log(`  ${chalk.cyan('claw-lite skills --scan <path>')} - Scan for safety issues`);
    console.log();
    console.log(chalk.gray('Skills are verified for:'));
    console.log(chalk.gray('  • Prompt injection patterns'));
    console.log(chalk.gray('  • Code execution attempts'));
    console.log(chalk.gray('  • File system access'));
    console.log(chalk.gray('  • Network requests'));
    console.log(chalk.gray('  • Binary data in text files'));
  });

// Test command
program
  .command('test')
  .description('Run comprehensive tests')
  .action(async () => {
    const spinner = ora('Running tests...').start();
    
    try {
      // Test 1: Context Manager
      spinner.text = 'Testing context manager...';
      const manager = new ContextManager({ maxContextTokens: 4000 });
      const sample = createSampleConversation(20);
      const result = await manager.compressHistory(sample, 'Test system prompt');
      
      if (result.messages.length <= sample.length && result.compressionRatio <= 1) {
        spinner.text = '✓ Context manager passed';
      } else {
        throw new Error('Context manager test failed');
      }
      
      // Test 2: Model Router
      spinner.text = 'Testing model router...';
      const router = new ModelRouter();
      const task = {
        estimatedInputTokens: 3000,
        estimatedOutputTokens: 500,
        needsTools: true,
        needsVision: false,
        priority: 'cost' as const
      };
      
      const selection = router.selectModel(task);
      if (!selection.modelId) {
        throw new Error('Model router test failed');
      }
      
      // Test 3: Token Estimator
      spinner.text = 'Testing token estimator...';
      const estimator = new TokenEstimator();
      const testText = 'Hello, world! This is a test.';
      const tokens = estimator.estimate(testText);
      
      if (tokens > 0 && tokens < testText.length) {
        spinner.succeed('All tests passed!');
        console.log(chalk.green('\n✅ OpenClaw Lite is working correctly.'));
        console.log(chalk.gray('\nTest summary:'));
        console.log(`  Context compression: ${result.compressionRatio.toFixed(2)} ratio`);
        console.log(`  Model selection: ${selection.modelId}`);
        console.log(`  Token estimation: ${tokens} tokens for "${testText.substring(0, 20)}..."`);
      } else {
        throw new Error('Token estimator test failed');
      }
      
    } catch (error) {
      spinner.fail('Tests failed');
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

async function configureSkillCredentials(
  skillName: string,
  credentials: any[],
  credentialManager: any
): Promise<void> {
  const needsConfirmation = credentialManager.needsCredentialConfirmation(skillName);
  if (needsConfirmation) {
    console.log(chalk.yellow('\n⚠️  Skill credential requirements changed. Re-confirmation required.'));
  }
  
  const requiredCreds = credentials.filter((cred) => cred.required);
  if (requiredCreds.length > 0) {
    const proceed = await promptYesNo('Configure required credentials now?', true);
    if (!proceed) {
      console.log(chalk.yellow('⚠️  Required credentials not configured. Skill may not run.'));
      return;
    }
  }
  
  for (const cred of credentials) {
    const alreadyInstalled = credentialManager.hasCredential(skillName, cred.name);
    const isOptional = !cred.required;
    
    if (alreadyInstalled && !needsConfirmation) {
      continue;
    }
    
    if (isOptional) {
      const shouldConfigure = await promptYesNo(`Configure optional credential "${cred.name}"?`, false);
      if (!shouldConfigure) {
        continue;
      }
    }
    
    const authFlow = cred.authFlow || (cred.type === 'oauth_token' ? 'oauth' : 'manual');
    if (authFlow === 'oauth') {
      const authUrl = cred.oauth?.authUrl || cred.helpUrl;
      if (!authUrl) {
        console.log(chalk.yellow(`⚠️  OAuth credential "${cred.name}" requires an auth URL. Skipping.`));
        continue;
      }
      const request = await credentialManager.createOAuthRequest(
        skillName,
        cred.name,
        authUrl,
        cred.oauth?.provider,
        cred.oauth?.scopes || cred.scopes
      );
      console.log(chalk.cyan(`
🔐 OAuth required for ${cred.name}`));
      console.log(chalk.gray(`   Open Admin UI to complete OAuth flow:`));
      console.log(chalk.gray(`   ${authUrl}`));
      console.log(chalk.gray(`   Request ID: ${request.requestId}`));
      continue;
    }
    
    const prompt = cred.prompt || `Enter ${cred.description || cred.name}: `;
    const value = await promptSecret(prompt);
    if (!value) {
      console.log(chalk.yellow(`⚠️  No value provided for ${cred.name}, skipping.`));
      continue;
    }
    await credentialManager.installCredential(skillName, cred.name, value);
    console.log(chalk.green(`✅ Stored credential ${cred.name}`));
  }
  
  if (needsConfirmation) {
    credentialManager.confirmSkillCredentials(skillName);
  }
}

// CLI prompt helpers
function promptText(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptYesNo(question: string, defaultYes: boolean = true): Promise<boolean> {
  const suffix = defaultYes ? ' (Y/n) ' : ' (y/N) ';
  return promptText(question + suffix).then((answer) => {
    if (!answer) return defaultYes;
    return ['y', 'yes'].includes(answer.toLowerCase());
  });
}

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    const onData = (char: Buffer) => {
      const charStr = char.toString('utf8');
      if (charStr === '\n' || charStr === '\r' || charStr === '\u0004') {
        stdin.removeListener('data', onData);
        (rl as any).output.write('\n');
        rl.close();
        resolve(buffer.join(''));
      } else if (charStr === '\u0003') {
        process.exit(1);
      } else {
        buffer.push(charStr);
        (rl as any).output.write('*');
      }
    };
    const buffer: string[] = [];
    (rl as any).output.write(question);
    stdin.on('data', onData);
  });
}

async function getCredentialManager(): Promise<any | null> {
  try {
    const { SecureKeyManager } = await import('../security/secure-key-manager.js');
    const { CredentialManager } = await import('../security/credential-manager.js');
    const keyManager = new SecureKeyManager();
    if (!keyManager.isSecureStorageAvailable()) {
      return null;
    }
    return new CredentialManager();
  } catch {
    return null;
  }
}

// Helper function to create sample conversation
function createSampleConversation(count: number = 10): Message[] {
  const messages: Message[] = [];
  const roles: ('user' | 'assistant')[] = ['user', 'assistant'];
  
  for (let i = 0; i < count; i++) {
    const role = roles[i % 2];
    const content = role === 'user' 
      ? `User message ${i + 1}: Can you help me with something? This is a longer message to test token counting.`
      : `Assistant response ${i + 1}: I'd be happy to help! Here's some detailed information about the topic you asked about.`;
    
    messages.push({
      role,
      content,
      timestamp: new Date(Date.now() - (count - i) * 60000), // Staggered timestamps
      tokens: undefined
    });
  }
  
  // Add a system message at the beginning
  messages.unshift({
    role: 'system',
    content: 'You are a helpful AI assistant. Be concise and accurate.',
    timestamp: new Date(Date.now() - count * 60000),
    tokens: undefined
  });
  
  return messages;
}

// Run the CLI
program.parseAsync(process.argv).catch((error) => {
  console.error(chalk.red('Fatal error:'), error instanceof Error ? error.message : String(error));
  process.exit(1);
});