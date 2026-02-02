import express from 'express';
import cors from 'cors';
import { OllamaIntegration } from '../ollama/integration.js';
import { FileLoader } from '../identity/file-loader.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { getConfigManager } from '../config/config.js';
import type { Message } from '../context/types.js';

export interface WebServerOptions {
  port?: number;
  ollamaUrl?: string;
  model?: string;
  maxContextTokens?: number;
  enableCors?: boolean;
  systemPrompt?: string;
}

export class WebServer {
  private app: express.Application;
  private integration: OllamaIntegration;
  private fileLoader: FileLoader;
  private memoryManager: MemoryManager | null = null;
  private options: Required<WebServerOptions>;
  private systemPrompt: string = '';
  
  constructor(options: WebServerOptions = {}) {
    // Load default model from config
    let defaultModel = 'llama3.1:8b';
    try {
      const configManager = getConfigManager();
      const config = configManager.getConfig();
      defaultModel = config.ollama.defaultModel;
    } catch (error) {
      console.warn('Could not load config for default model:', error);
    }
    
    this.options = {
      port: 3000,
      ollamaUrl: 'http://localhost:11434',
      model: defaultModel,
      maxContextTokens: 8192,
      enableCors: true,
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
    
    this.fileLoader = new FileLoader(process.env.OPENCLAW_WORKSPACE || process.cwd());
    
    // Initialize memory manager if enabled
    try {
      const configManager = getConfigManager();
      const config = configManager.getConfig();
      
      if (config.memory.enabled) {
        this.memoryManager = new MemoryManager({
          storagePath: config.memory.storagePath,
          maxSessions: config.memory.maxSessions,
          pruneDays: config.memory.pruneDays,
        });
        console.log('💾 Memory system initialized for web sessions');
      } else {
        console.log('⚠️  Memory system disabled (enable via config)');
      }
    } catch (error) {
      console.warn('Failed to initialize memory manager:', error);
    }
    
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupStaticFiles();
  }
  
  private setupMiddleware() {
    if (this.options.enableCors) {
      this.app.use(cors());
    }
    
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }
  
  private setupStaticFiles() {
    // Serve static files from public directory
    this.app.use(express.static('public'));
    
    // If public directory doesn't exist, create a basic HTML response
    this.app.get('/', (req, res) => {
      if (req.accepts('html')) {
        res.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>OpenClaw Lite Web UI</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  max-width: 800px;
                  margin: 0 auto;
                  padding: 20px;
                  background: #0f172a;
                  color: #e2e8f0;
                }
                .header {
                  text-align: center;
                  margin-bottom: 30px;
                  padding: 20px;
                  background: #1e293b;
                  border-radius: 10px;
                  border: 1px solid #334155;
                }
                .chat-container {
                  background: #1e293b;
                  border-radius: 10px;
                  padding: 20px;
                  margin-bottom: 20px;
                  border: 1px solid #334155;
                  height: 400px;
                  overflow-y: auto;
                }
                .message {
                  margin-bottom: 15px;
                  padding: 10px 15px;
                  border-radius: 8px;
                  max-width: 80%;
                }
                .user-message {
                  background: #3b82f6;
                  color: white;
                  margin-left: auto;
                }
                .assistant-message {
                  background: #475569;
                  color: #e2e8f0;
                  margin-right: auto;
                }
                .input-area {
                  display: flex;
                  gap: 10px;
                }
                input {
                  flex: 1;
                  padding: 12px;
                  border: 1px solid #475569;
                  border-radius: 8px;
                  background: #1e293b;
                  color: #e2e8f0;
                  font-size: 16px;
                }
                button {
                  padding: 12px 24px;
                  background: #3b82f6;
                  color: white;
                  border: none;
                  border-radius: 8px;
                  cursor: pointer;
                  font-size: 16px;
                  font-weight: 500;
                }
                button:hover {
                  background: #2563eb;
                }
                .stats {
                  font-size: 12px;
                  color: #94a3b8;
                  margin-top: 5px;
                }
                .model-info {
                  color: #60a5fa;
                  font-weight: 500;
                }
                .model-selector {
                  display: flex;
                  align-items: center;
                  gap: 10px;
                  margin: 10px 0;
                  flex-wrap: wrap;
                }
                .model-selector label {
                  font-weight: 500;
                  color: #94a3b8;
                }
                .model-selector select {
                  padding: 6px 12px;
                  border: 1px solid #475569;
                  border-radius: 6px;
                  background: #1e293b;
                  color: #e2e8f0;
                  font-size: 14px;
                  min-width: 200px;
                }
                .model-selector select:focus {
                  outline: none;
                  border-color: #3b82f6;
                }
                .model-selector button {
                  padding: 6px 12px;
                  background: #475569;
                  color: #e2e8f0;
                  border: none;
                  border-radius: 6px;
                  cursor: pointer;
                  font-size: 14px;
                }
                .model-selector button:hover {
                  background: #64748b;
                }
                .model-status {
                  margin-left: 5px;
                  font-size: 14px;
                }
                .loading {
                  color: #fbbf24;
                }
                .success {
                  color: #10b981;
                }
                .error {
                  color: #ef4444;
                }
              </style>
            </head>
            <body>
              <div class="header">
                <h1>🤖 OpenClaw Lite Web UI</h1>
                <div class="model-selector">
                  <label for="model-select">Model:</label>
                  <select id="model-select" onchange="changeModel(this.value)">
                    <option value="huihui_ai/qwen3-abliterated:latest" ${this.options.model === 'huihui_ai/qwen3-abliterated:latest' ? 'selected' : ''}>qwen3-abliterated</option>
                    <option value="llama3.1:8b" ${this.options.model === 'llama3.1:8b' ? 'selected' : ''}>llama3.1:8b</option>
                    <option value="qwen2.5-coder:7b" ${this.options.model === 'qwen2.5-coder:7b' ? 'selected' : ''}>qwen2.5-coder:7b</option>
                    <option value="gemma3:latest" ${this.options.model === 'gemma3:latest' ? 'selected' : ''}>gemma3:latest</option>
                    <option value="deepseek-r1:8b" ${this.options.model === 'deepseek-r1:8b' ? 'selected' : ''}>deepseek-r1:8b</option>
                  </select>
                  <button id="refresh-models" onclick="refreshModels()" title="Refresh available models">🔄</button>
                  <span class="model-status" id="model-status">✅</span>
                </div>
                <div class="session-controls" style="margin-top: 10px;">
                  <button onclick="newSession()" title="Start new conversation" style="padding: 6px 12px; background: #475569; color: #e2e8f0; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">🆕 New Session</button>
                  <button onclick="listSessions()" title="View saved sessions" style="padding: 6px 12px; background: #475569; color: #e2e8f0; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin-left: 5px;">📋 Sessions</button>
                  <span id="session-status" style="margin-left: 10px; font-size: 14px; color: #94a3b8;"></span>
                </div>
                <p>URL: ${this.options.ollamaUrl} | Context: ${this.options.maxContextTokens.toLocaleString()} tokens</p>
              </div>
              
              <div class="chat-container" id="chat">
                <div class="message assistant-message">
                  Hello! I'm Ada, your AI chaos gremlin. 😏 How can I help you today?
                </div>
              </div>
              
              <div class="input-area">
                <input type="text" id="message" placeholder="Type your message..." autocomplete="off">
                <button onclick="sendMessage()">Send</button>
              </div>
              
              <script>
                const chat = document.getElementById('chat');
                const messageInput = document.getElementById('message');
                
                messageInput.addEventListener('keypress', (e) => {
                  if (e.key === 'Enter') sendMessage();
                });
                
                async function sendMessage() {
                  const text = messageInput.value.trim();
                  if (!text) return;
                  
                  // Add user message
                  addMessage(text, 'user');
                  messageInput.value = '';
                  
                  // Show thinking
                  const thinking = addMessage('Thinking...', 'assistant');
                  
                  try {
                    const response = await fetch('/api/chat', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ 
                        message: text
                      })
                    });
                    
                    const data = await response.json();
                    
                    // Replace thinking with actual response
                    thinking.innerHTML = \`
                      <div>\${data.response}</div>
                      <div class="stats">
                        ⏱️ \${data.timing?.total || 0}ms | 
                        📊 \${data.tokens?.input || 0}+\${data.tokens?.output || 0} tokens |
                        🧠 \${data.context?.compressedMessages || 0}/\${data.context?.originalMessages || 0} msgs
                      </div>
                    \`;
                    
                  } catch (error) {
                    thinking.innerHTML = \`❌ Error: \${error.message}\`;
                  }
                }
                
                function addMessage(text, role) {
                  const div = document.createElement('div');
                  div.className = \`message \${role}-message\`;
                  div.innerHTML = text;
                  chat.appendChild(div);
                  chat.scrollTop = chat.scrollHeight;
                  return div;
                }
                
                // Model management functions
                async function changeModel(modelName) {
                  const status = document.getElementById('model-status');
                  const select = document.getElementById('model-select');
                  
                  status.textContent = '⏳';
                  status.className = 'model-status loading';
                  select.disabled = true;
                  
                  try {
                    const response = await fetch('/api/model', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ model: modelName })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                      status.textContent = '✅';
                      status.className = 'model-status success';
                      
                      // Add system message about model change
                      addMessage(\`Model changed to \${modelName}\`, 'assistant');
                    } else {
                      status.textContent = '❌';
                      status.className = 'model-status error';
                      console.error('Model change failed:', data.error);
                    }
                  } catch (error) {
                    status.textContent = '❌';
                    status.className = 'model-status error';
                    console.error('Failed to change model:', error);
                  } finally {
                    select.disabled = false;
                  }
                }
                
                async function refreshModels() {
                  const status = document.getElementById('model-status');
                  const select = document.getElementById('model-select');
                  const refreshBtn = document.getElementById('refresh-models');
                  
                  status.textContent = '⏳';
                  status.className = 'model-status loading';
                  select.disabled = true;
                  refreshBtn.disabled = true;
                  
                  try {
                    const response = await fetch('/api/models');
                    const data = await response.json();
                    
                    if (data.models && Array.isArray(data.models)) {
                      // Save current selection
                      const currentModel = select.value;
                      
                      // Clear existing options (keep first 5 default ones)
                      while (select.options.length > 5) {
                        select.remove(5);
                      }
                      
                      // Add available models
                      data.models.forEach(model => {
                        // Skip if already in default options
                        const defaultModels = ['llama3.1:8b', 'qwen2.5-coder:7b', 'qwen3:latest', 'gemma3:latest', 'deepseek-r1:8b'];
                        if (!defaultModels.includes(model)) {
                          const option = document.createElement('option');
                          option.value = model;
                          option.textContent = model;
                          option.selected = (model === currentModel);
                          select.appendChild(option);
                        }
                      });
                      
                      status.textContent = \`✅ \${data.models.length} models\`;
                      status.className = 'model-status success';
                    }
                  } catch (error) {
                    status.textContent = '❌';
                    status.className = 'model-status error';
                    console.error('Failed to refresh models:', error);
                  } finally {
                    select.disabled = false;
                    refreshBtn.disabled = false;
                  }
                }
                
                // Load available models on page load
                document.addEventListener('DOMContentLoaded', () => {
                  refreshModels();
                });
              </script>
            </body>
          </html>
        `);
      } else {
        res.json({
          name: 'OpenClaw Lite Web Server',
          version: '0.1.0',
          endpoints: {
            chat: 'POST /api/chat',
            health: 'GET /api/health',
            models: 'GET /api/models',
            session: 'GET /api/session/:id'
          }
        });
      }
    });
  }
  
  private setupRoutes() {
    // Health check
    this.app.get('/api/health', async (_req, res) => {
      try {
        const health = await this.integration.healthCheck();
        
        let memoryStats = null;
        if (this.memoryManager) {
          const stats = this.memoryManager.getSessionStats();
          memoryStats = {
            enabled: true,
            totalSessions: stats.totalSessions,
            totalMessages: stats.totalMessages,
            totalTokens: stats.totalTokens,
          };
        }
        
        return res.json({
          status: 'ok',
          ollama: health.ollama,
          model: this.options.model,
          models: health.models.length,
          memory: memoryStats || { enabled: false },
          endpoints: {
            chat: 'POST /api/chat',
            health: 'GET /api/health',
            models: 'GET /api/models',
            session: 'GET /api/session/:id',
            sessions: 'GET /api/sessions'
          }
        });
      } catch (error) {
        return res.status(500).json({
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // List models
    this.app.get('/api/models', async (_req, res) => {
      try {
        const health = await this.integration.healthCheck();
        return res.json({
          models: health.models,
          default: this.options.model,
          available: health.models.includes(this.options.model.replace('ollama/', ''))
        });
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Chat endpoint with memory integration
    this.app.post('/api/chat', async (req, res) => {
      const { message, sessionId: clientSessionId, createNew = false } = req.body;
      
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message is required' });
      }
      
      try {
        // Determine session ID
        let sessionId = clientSessionId;
        let isNewSession = false;
        
        if (!sessionId || createNew) {
          // Generate new session ID
          sessionId = this.memoryManager ? 
            this.memoryManager.generateSessionId() : 
            `web_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          isNewSession = true;
          console.log(`💾 Created new web session: ${sessionId}`);
        }
        
        // Load session messages from memory or start fresh
        let sessionMessages: Message[] = [];
        
        if (this.memoryManager && !createNew) {
          const session = this.memoryManager.loadSession(sessionId);
          if (session) {
            sessionMessages = session.messages;
            console.log(`💾 Loaded web session: ${sessionId} (${sessionMessages.length} messages)`);
          } else if (clientSessionId) {
            console.log(`💾 Session ${sessionId} not found, starting fresh`);
          }
        }
        
        // Add user message
        const userMessage: Message = {
          role: 'user',
          content: message,
          timestamp: new Date()
        };
        
        sessionMessages.push(userMessage);
        
        // Generate response
        const startTime = Date.now();
        
        const result = await this.integration.complete(
          sessionMessages,
          this.systemPrompt,
          undefined, // taskRequirements
          this.options.model // forceModel
        );
        
        const responseTime = Date.now() - startTime;
        
        // Add assistant message
        const assistantMessage: Message = {
          role: 'assistant',
          content: result.response,
          timestamp: new Date()
        };
        
        sessionMessages.push(assistantMessage);
        
        // Save to memory if enabled
        if (this.memoryManager) {
          this.memoryManager.saveSession(sessionId, sessionMessages, {
            name: `Web Chat ${new Date().toLocaleString()}`,
            tags: ['web-ui', 'chat'],
            metadata: {
              source: 'web-ui',
              model: this.options.model,
              url: this.options.ollamaUrl,
            },
          });
          console.log(`💾 Saved web session: ${sessionId} (${sessionMessages.length} messages)`);
        }
        
        // Return response
        return res.json({
          response: result.response,
          sessionId,
          isNewSession,
          timing: {
            total: responseTime,
            promptEval: result.timing?.promptEval || 0,
            eval: result.timing?.eval || 0
          },
          tokens: result.tokens,
          context: result.context,
          model: result.modelUsed,
          memoryEnabled: !!this.memoryManager
        });
        
      } catch (error) {
        console.error('Chat error:', error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
          suggestion: 'Check if Ollama is running and model is loaded'
        });
      }
    });
    
    // Get session info
    this.app.get('/api/session/:id', async (req, res) => {
      const sessionId = req.params.id;
      
      try {
        if (this.memoryManager) {
          const session = this.memoryManager.loadSession(sessionId);
          if (session) {
            return res.json({
              sessionId,
              name: session.metadata.name,
              messages: session.messages.length,
              tokens: session.metadata.totalTokens,
              createdAt: session.metadata.createdAt,
              lastAccessed: session.metadata.lastAccessed,
              tags: session.metadata.tags,
              memory: true
            });
          }
        }
        
        return res.status(404).json({
          error: 'Session not found',
          sessionId,
          memory: false
        });
        
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // List sessions
    this.app.get('/api/sessions', async (_req, res) => {
      try {
        if (this.memoryManager) {
          const sessions = this.memoryManager.listSessions({ 
            limit: 50, 
            sortBy: 'lastAccessed', 
            order: 'desc' 
          });
          
          return res.json({
            sessions: sessions.map(session => ({
              sessionId: session.sessionId,
              name: session.name,
              messages: session.messageCount,
              tokens: session.totalTokens,
              createdAt: session.createdAt,
              lastAccessed: session.lastAccessed,
              tags: session.tags,
              source: session.metadata?.source || 'unknown'
            })),
            memory: true
          });
        }
        
        return res.json({
          sessions: [],
          memory: false,
          message: 'Memory system not enabled'
        });
        
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Clear session
    this.app.delete('/api/session/:id', async (req, res) => {
      const sessionId = req.params.id;
      
      try {
        if (this.memoryManager) {
          const deleted = this.memoryManager.deleteSession(sessionId);
          
          return res.json({
            success: deleted,
            sessionId,
            message: deleted ? 'Session deleted from memory' : 'Session not found',
            memory: true
          });
        }
        
        return res.json({
          success: false,
          sessionId,
          message: 'Memory system not enabled',
          memory: false
        });
        
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Update model
    this.app.post('/api/model', async (req, res) => {
      const { model } = req.body;
      
      if (!model || typeof model !== 'string') {
        return res.status(400).json({ error: 'Model name is required' });
      }
      
      try {
        // Check if model exists
        const health = await this.integration.healthCheck();
        const modelName = model.replace('ollama/', '');
        
        if (!health.models.includes(modelName)) {
          return res.status(400).json({
            error: `Model not found. Available: ${health.models.join(', ')}`
          });
        }
        
        // Update integration
        this.options.model = model;
        this.integration.updateOllamaConfig({ model });
        
        // Try to load the model with a test request (with timeout)
        try {
          // We'll just update the config - the model will load on first use
          console.log(`✅ Model configuration updated to ${model}`);
          console.log(`   Note: Model will load on first use (may take 10-30 seconds)`);
          
        } catch (loadError) {
          console.log(`⚠️  Model configuration updated but may need time to load:`, loadError instanceof Error ? loadError.message : String(loadError));
        }
        
        return res.json({
          success: true,
          model,
          message: `Model updated to ${model}. Note: Some models may take 10-30 seconds to load into VRAM.`
        });
        
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
          suggestion: 'Model might need to be loaded. Try again in 10-20 seconds.'
        });
      }
    });
  }
  
  async start() {
    // Load identity files first
    console.log('📚 Loading identity files...');
    
    try {
      this.systemPrompt = await this.fileLoader.constructSystemPrompt();
      console.log('✅ Identity loaded from SOUL.md, USER.md, and memory files');
      
      // Show identity summary
      const identity = await this.fileLoader.loadIdentity();
      if (identity.soul) {
        const soulPreview = identity.soul.substring(0, 100) + (identity.soul.length > 100 ? '...' : '');
        console.log(`   SOUL.md: ${soulPreview}`);
      }
      if (identity.user) {
        console.log(`   USER.md: Loaded (${identity.user.length} chars)`);
      }
      if (identity.memory && identity.memory.length > 0) {
        console.log(`   Memory: ${identity.memory.length} entries loaded`);
      }
      
    } catch (error) {
      console.log('⚠️  Could not load identity files:', error instanceof Error ? error.message : String(error));
      console.log('   Using default system prompt');
      this.systemPrompt = this.options.systemPrompt || 'You are a helpful AI assistant.';
    }
    
    // Check Ollama health
    console.log('\n🔍 Checking Ollama connection...');
    
    try {
      const health = await this.integration.healthCheck();
      
      if (!health.ollama) {
        console.log('❌ Ollama not running at', this.options.ollamaUrl);
        console.log('   Start it with: ollama serve');
        process.exit(1);
      }
      
      console.log('✅ Ollama connected');
      console.log(`   Models available: ${health.models.length}`);
      console.log(`   Using model: ${this.options.model}`);
      
      if (!health.models.includes(this.options.model.replace('ollama/', ''))) {
        console.log(`⚠️  Model "${this.options.model}" not found, using default`);
      }
      
    } catch (error) {
      console.log('❌ Failed to connect to Ollama:', error instanceof Error ? error.message : String(error));
      console.log(`   URL: ${this.options.ollamaUrl}`);
      process.exit(1);
    }
    
    // Start server
    return new Promise<void>((resolve) => {
      this.app.listen(this.options.port, '0.0.0.0', () => {
        console.log('\n🚀 OpenClaw Lite Web Server');
        console.log('─'.repeat(40));
        console.log(`📡 Local: http://localhost:${this.options.port}`);
        console.log(`📡 Network: http://0.0.0.0:${this.options.port}`);
        
        // Try to get local IP addresses
        try {
          const os = require('os');
          const interfaces = os.networkInterfaces();
          
          console.log(`\n🌐 Network interfaces:`);
          Object.entries(interfaces).forEach(([name, iface]) => {
            if (Array.isArray(iface)) {
              iface.forEach((addr) => {
                if (addr.family === 'IPv4' && !addr.internal) {
                  console.log(`   ${name}: http://${addr.address}:${this.options.port}`);
                }
              });
            }
          });
        } catch (error) {
          // Ignore if network info fails
        }
        
        console.log(`\n🤖 Model: ${this.options.model}`);
        console.log(`🔗 Ollama: ${this.options.ollamaUrl}`);
        console.log(`🧠 Context: ${this.options.maxContextTokens.toLocaleString()} tokens`);
        console.log('\n📋 Endpoints:');
        console.log(`   GET  /              - Web UI`);
        console.log(`   POST /api/chat      - Chat endpoint`);
        console.log(`   GET  /api/health    - Health check`);
        console.log(`   GET  /api/models    - List models`);
        console.log(`   POST /api/model     - Change model`);
        console.log('\n💡 Press Ctrl+C to stop');
        console.log('─'.repeat(40));
        
        resolve();
      });
    });
  }
  
  stop() {
    // Cleanup if needed
    if (this.memoryManager) {
      // Any memory cleanup if needed
    }
  }
}

// Export a simple start function
export async function startWebServer(options: WebServerOptions = {}) {
  const server = new WebServer(options);
  await server.start();
  return server;
}