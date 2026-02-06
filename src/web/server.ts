import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import { OllamaIntegration } from '../ollama/integration.js';
import { FileLoader } from '../identity/file-loader.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { ToolManager } from '../tools/tool-manager.js';
import { OpenClawToolIntegration } from '../tools/openclaw-tool-integration.js';
import { AgentIntegration } from '../agent/agent-integration.js';
import { RunQueue } from '../agent/run-queue.js';
import { MemoryIntegration } from '../agent/memory-integration.js';
import { MemoryStreamingAgent } from '../agent/memory-streaming-agent.js';
import { getConfigManager, initializeConfigSync } from '../config/openclaw-lite-config.js';
import { createDefaultBasicPrompt } from '../agent/basic-prompt.js';
import { PersonalityUpdater } from '../identity/personality-updater.js';
import { UserInfoUpdater } from '../identity/user-info-updater.js';
import type { Message } from '../context/types.js';
import type { AgentHookContext } from '../agent/hooks.js';
import type { ToolExecutionResult } from '../agent/types.js';
import type { ToolCall, ToolUsageLog } from '../tools/types.js';

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
  private toolIntegration: OpenClawToolIntegration | null = null;
  private agentIntegration: AgentIntegration | null = null;
  private memoryStreamingAgent: MemoryStreamingAgent | null = null;
  private memoryIntegration: MemoryIntegration | null = null;
  private fileLoader: FileLoader;
  private toolManager: ToolManager;
  private memoryManager: MemoryManager | null = null;
  private personalityUpdater: PersonalityUpdater | null = null;
  private userInfoUpdater: UserInfoUpdater | null = null;
  private options: Required<WebServerOptions>;
  private systemPrompt: string = '';
  private pendingApprovals: Map<string, { call: ToolCall; resolve: (approved: boolean) => void }> = new Map();
  private approvalsDisabled: boolean = false;
  private workspacePath: string;
  private identityPath: string;
  private runQueue: RunQueue;
  
  constructor(options: WebServerOptions = {}) {
    // Load default model from config
    let defaultModel = 'Qwen3-4B-Instruct-2507:latest';
    try {
      const configManager = initializeConfigSync();
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
    
    // Initialize configuration synchronously
    const configManager = initializeConfigSync();
    const config = configManager.getConfig();
    
    // Use configured workspace
    const workspacePath = config.workspace.path;
    const identityPath = configManager.getIdentityPath();
    const memoryPath = configManager.getMemoryPath();
    this.workspacePath = workspacePath;
    this.identityPath = identityPath;
    this.runQueue = new RunQueue();
    this.fileLoader = new FileLoader({
      workspacePath,
      identityPath,
      memoryPath
    });
    console.log(`📁 Workspace: ${workspacePath}`);
    
    // Initialize memory manager if enabled
    try {
      if (config.memory.enabled) {
        this.memoryManager = new MemoryManager({
          storagePath: configManager.getMemoryPath(),
          maxSessions: config.memory.maxSessions,
          pruneDays: config.memory.pruneDays,
        });
        console.log('💾 Memory system initialized');
      } else {
        console.log('⚠️  Memory system disabled (enable via config)');
      }
    } catch (error) {
      console.warn('Failed to initialize memory manager:', error);
    }
    
    // Initialize personality updater
    try {
      this.personalityUpdater = new PersonalityUpdater(workspacePath);
      console.log('🧠 Personality updater initialized');
    } catch (error) {
      console.warn('Failed to initialize personality updater:', error);
    }
    
    // Initialize user info updater
    try {
      this.userInfoUpdater = new UserInfoUpdater(workspacePath);
      console.log('👤 User info updater initialized');
    } catch (error) {
      console.warn('Failed to initialize user info updater:', error);
    }
    
    // Initialize tool manager
    this.approvalsDisabled = config.tools.disableApprovals;
    const requireApprovalForDangerous = this.approvalsDisabled ? false : true;
    
    this.toolManager = new ToolManager({
      workspacePath,
      identityPath,
      memoryPath,
      requireApprovalForDangerous,
      disableApprovals: this.approvalsDisabled,
      maxLogSize: 1000,
      configPath: configManager.getToolConfigPath()
    });
    
    console.log('🔧 Tool system initialized');
    if (this.approvalsDisabled) {
      console.log('⚠️  Tool approvals DISABLED (development mode)');
    } else {
      console.log('🔐 Tool approvals ENABLED for dangerous tools');
    }
    
    // Initialize OpenClaw-style tool integration
    this.toolIntegration = new OpenClawToolIntegration(
      this.toolManager,
      {
        baseUrl: this.options.ollamaUrl,
        defaultModel: this.options.model,
        temperature: 0.7,
        maxToolCalls: 5,
        allowDangerousTools: false,
        requireApproval: true,
      }
    );
    console.log('🤖 AI tool calling enabled (OpenClaw style)');
    
    // Initialize agent integration (Phase 1)
    this.agentIntegration = new AgentIntegration({
      toolManager: this.toolManager,
      model: this.options.model,
      temperature: 0.7,
      maxToolCalls: 5,
      maxTurns: 10,
      timeoutMs: 120000,
      baseUrl: this.options.ollamaUrl,
      workspacePath: process.cwd(),
      sessionId: 'web-server',
      runQueue: this.runQueue,
    });
    console.log('🤖 Agent integration enabled (Phase 1)');

    this.agentIntegration.registerHook('beforeAgentStart', (context: AgentHookContext) => {
      return {
        systemPrompt: `${context.systemPrompt}\n\n## Runtime Note\n- Web server hook active (example)`
      };
    });
    this.agentIntegration.registerHook('afterToolCall', (_context: AgentHookContext, execution: ToolExecutionResult) => {
      console.log(`[Hook] Tool ${execution.toolName} ${execution.success ? 'ok' : 'failed'}`);
    });
    
    // Initialize memory streaming agent (Phase 3)
    if (this.agentIntegration.getAgentLoop() && this.agentIntegration.getToolBridge()) {
      // Create memory manager if not already created
      if (!this.memoryManager) {
        try {
          const configManager = getConfigManager();
          const config = configManager.getConfig();
          
          this.memoryManager = new MemoryManager({
            storagePath: config.memory.storagePath,
            maxSessions: config.memory.maxSessions,
            pruneDays: config.memory.pruneDays,
          });
          console.log('💾 Memory manager created (was disabled in config)');
        } catch (error) {
          console.warn('Failed to create memory manager:', error instanceof Error ? error.message : String(error));
          console.log('⚠️  Memory features will be disabled');
        }
      }
      
      if (this.memoryManager) {
        // Create memory integration
        this.memoryIntegration = new MemoryIntegration(this.memoryManager, {
          enabled: true,
          searchLimit: 5,
        });
        
        // Create memory streaming agent
        this.memoryStreamingAgent = new MemoryStreamingAgent(
          this.agentIntegration.getAgentLoop(),
          this.agentIntegration.getToolBridge(),
          this.memoryIntegration
        );
        console.log('🧠 Memory streaming agent enabled (Phase 3)');
      } else {
        console.log('⚠️  Memory streaming agent disabled (no memory manager)');
      }
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
                  margin: 0;
                  padding: 0;
                  background: #0f172a;
                  color: #e2e8f0;
                  height: 100vh;
                  overflow: hidden;
                }

                .app {
                  display: flex;
                  height: 100vh;
                  width: 100vw;
                  overflow: hidden;
                }
                
                /* Sidebar */
                .sidebar {
                  width: 300px;
                  background: #1e293b;
                  border-right: 1px solid #334155;
                  display: flex;
                  flex-direction: column;
                  overflow: hidden;
                }
                
                .sidebar-header {
                  padding: 20px;
                  border-bottom: 1px solid #334155;
                }
                
                .sidebar-tabs {
                  display: flex;
                  border-bottom: 1px solid #334155;
                }
                
                .sidebar-tab {
                  flex: 1;
                  padding: 12px;
                  background: transparent;
                  border: none;
                  color: #94a3b8;
                  cursor: pointer;
                  font-size: 14px;
                  text-align: center;
                  transition: all 0.2s;
                }
                
                .sidebar-tab:hover {
                  background: #2d3748;
                  color: #e2e8f0;
                }
                
                .sidebar-tab.active {
                  background: #3b82f6;
                  color: white;
                }
                
                .sidebar-content {
                  flex: 1;
                  overflow-y: auto;
                  padding: 20px;
                }
                
                .tab-pane {
                  display: none;
                }
                
                .tab-pane.active {
                  display: block;
                }
                
                /* Tools panel */
                .tool-item {
                  background: #2d3748;
                  border-radius: 8px;
                  padding: 12px;
                  margin-bottom: 10px;
                  border: 1px solid #4a5568;
                }
                
                .tool-name {
                  font-weight: bold;
                  color: #60a5fa;
                  margin-bottom: 4px;
                }
                
                .tool-desc {
                  font-size: 13px;
                  color: #94a3b8;
                  margin-bottom: 8px;
                }
                
                .tool-meta {
                  display: flex;
                  gap: 8px;
                  font-size: 12px;
                }
                
                .tool-tag {
                  background: #4a5568;
                  padding: 2px 6px;
                  border-radius: 4px;
                }
                
                .tool-tag.dangerous {
                  background: #dc2626;
                  color: white;
                }
                
                /* Activity feed */
                .activity-item {
                  background: #2d3748;
                  border-radius: 8px;
                  padding: 12px;
                  margin-bottom: 10px;
                  border-left: 4px solid #3b82f6;
                }
                
                .activity-item.success {
                  border-left-color: #10b981;
                }
                
                .activity-item.error {
                  border-left-color: #dc2626;
                }
                
                .activity-header {
                  display: flex;
                  justify-content: space-between;
                  margin-bottom: 8px;
                }
                
                .activity-tool {
                  font-weight: bold;
                  color: #60a5fa;
                }
                
                .activity-time {
                  font-size: 12px;
                  color: #94a3b8;
                }
                
                .activity-result {
                  font-size: 13px;
                  color: #94a3b8;
                  font-family: 'Monaco', 'Menlo', monospace;
                  white-space: pre-wrap;
                  word-break: break-all;
                  max-height: 100px;
                  overflow-y: auto;
                  background: #1e293b;
                  padding: 8px;
                  border-radius: 4px;
                  margin-top: 8px;
                }
                
                /* File browser */
                .file-item {
                  display: flex;
                  align-items: center;
                  padding: 8px;
                  border-radius: 6px;
                  cursor: pointer;
                  transition: background 0.2s;
                }
                
                .file-item:hover {
                  background: #2d3748;
                }
                
                .file-icon {
                  margin-right: 10px;
                  font-size: 18px;
                }
                
                .file-name {
                  flex: 1;
                }
                
                .file-size {
                  font-size: 12px;
                  color: #94a3b8;
                }
                
                /* Main chat area */
                .main-content {
                  flex: 1;
                  display: flex;
                  flex-direction: column;
                  gap: 12px;
                  padding: 16px;
                  overflow: hidden;
                }
                
                .header {
                  padding: 16px 20px;
                  background: #1e293b;
                  border: 1px solid #334155;
                  border-radius: 12px;
                }
                
                .chat-container {
                  background: #1e293b;
                  border-radius: 12px;
                  padding: 16px;
                  border: 1px solid #334155;
                  flex: 1;
                  min-height: 0;
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
                  background: #1e293b;
                  border: 1px solid #334155;
                  border-radius: 12px;
                  padding: 12px;
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
                .thinking-container {
                  background: #1e293b;
                  border: 1px solid #475569;
                  border-radius: 8px;
                  margin-bottom: 10px;
                  padding: 10px;
                  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                  font-size: 13px;
                }
                .thinking-header {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  margin-bottom: 8px;
                  padding-bottom: 8px;
                  border-bottom: 1px solid #334155;
                }
                .thinking-toggle {
                  color: #60a5fa;
                  cursor: pointer;
                  font-weight: 500;
                }
                .thinking-toggle:hover {
                  color: #3b82f6;
                }
                .thinking-hide {
                  background: #475569;
                  color: #94a3b8;
                  border: none;
                  border-radius: 4px;
                  padding: 4px 8px;
                  font-size: 12px;
                  cursor: pointer;
                }
                .thinking-hide:hover {
                  background: #64748b;
                }
                .thinking-content {
                  white-space: pre-wrap;
                  color: #94a3b8;
                  max-height: 200px;
                  overflow-y: auto;
                  padding: 8px;
                  background: #0f172a;
                  border-radius: 4px;
                }

                .pill-button {
                  padding: 6px 12px;
                  background: #475569;
                  color: #e2e8f0;
                  border: none;
                  border-radius: 6px;
                  cursor: pointer;
                  font-size: 14px;
                }

                .pill-button:hover {
                  background: #64748b;
                }

                .sidebar-placeholder {
                  font-size: 13px;
                  color: #94a3b8;
                  line-height: 1.4;
                }
              </style>
            </head>
            <body>
              <div class="app">
                <aside class="sidebar">
                  <div class="sidebar-header">
                    <div style="font-weight: 700; font-size: 16px;">OpenClaw Lite</div>
                    <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Local tools & activity</div>
                  </div>
                  <div class="sidebar-content">
                    <div class="sidebar-placeholder">
                      Tools, activity, and file views will show up here. Use the chat panel to interact with the agent.
                    </div>
                  </div>
                </aside>
                <main class="main-content">
                  <div class="header">
                    <h1 style="margin: 0 0 8px 0;">🤖 OpenClaw Lite</h1>
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
                      <button onclick="newSession()" title="Start new conversation" class="pill-button">🆕 New Session</button>
                      <button onclick="listSessions()" title="View saved sessions" class="pill-button" style="margin-left: 6px;">📋 Sessions</button>
                      <span id="session-status" style="margin-left: 10px; font-size: 14px; color: #94a3b8;"></span>
                    </div>
                    <p style="margin: 10px 0 0 0; color: #94a3b8;">URL: ${this.options.ollamaUrl} | Context: ${this.options.maxContextTokens.toLocaleString()} tokens</p>
                  </div>
                  
                  <div class="chat-container" id="chat">
                    <div class="message assistant-message">
                      Hello! I'm your OpenClaw Lite assistant. How can I help you today?
                    </div>
                  </div>
                  
                  <div class="input-area">
                    <input type="text" id="message" placeholder="Type your message..." autocomplete="off">
                    <button onclick="sendMessage()">Send</button>
                  </div>
                </main>
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
                    const response = await fetch('/api/chat-with-tools', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ 
                        message: text
                      })
                    });
                    
                    const data = await response.json();
                    
                    // Parse thinking tags if present
                    let displayResponse = data.response;
                    let thinkingContent = '';
                    
                    const thinkMatch = data.response.match(/<think>([\\s\\S]*?)<\\/think>/);
                    if (thinkMatch) {
                      thinkingContent = thinkMatch[1].trim();
                      displayResponse = data.response.replace(/<think>[\\s\\S]*?<\\/think>\\s*/g, '').trim();
                      
                      // Update thinking placeholder with actual thinking
                      thinking.innerHTML = \`
                        <div class="thinking-container">
                          <div class="thinking-header">
                            <span class="thinking-toggle">🤔 Thinking</span>
                            <button class="thinking-hide">Hide</button>
                          </div>
                          <div class="thinking-content">\${thinkingContent}</div>
                        </div>
                        <div class="assistant-message message">
                          <div>\${displayResponse}</div>
                          <div class="stats">
                            ⏱️ \${data.timing?.total || 0}ms | 
                            📊 \${data.tokens?.input || 0}+\${data.tokens?.output || 0} tokens |
                            🧠 \${data.context?.compressedMessages || 0}/\${data.context?.originalMessages || 0} msgs
                          </div>
                        </div>
                      \`;
                      
                      // Add toggle functionality
                      const thinkingToggle = thinking.querySelector('.thinking-toggle');
                      const thinkingHide = thinking.querySelector('.thinking-hide');
                      const thinkingContentEl = thinking.querySelector('.thinking-content');
                      
                      thinkingToggle.onclick = () => {
                        thinkingContentEl.style.display = thinkingContentEl.style.display === 'none' ? 'block' : 'none';
                      };
                      
                      thinkingHide.onclick = () => {
                        thinking.querySelector('.thinking-container').style.display = 'none';
                      };
                    } else {
                      // No thinking tags, just show response
                      thinking.innerHTML = \`
                        <div>\${displayResponse}</div>
                        <div class="stats">
                          ⏱️ \${data.timing?.total || 0}ms | 
                          📊 \${data.tokens?.input || 0}+\${data.tokens?.output || 0} tokens |
                          🧠 \${data.context?.compressedMessages || 0}/\${data.context?.originalMessages || 0} msgs
                        </div>
                      \`;
                    }
                    
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

                function newSession() {
                  const chatEl = document.getElementById('chat');
                  const sessionStatus = document.getElementById('session-status');
                  if (chatEl) {
                    chatEl.innerHTML = '<div class="message assistant-message">New session started. How can I help?</div>';
                  }
                  if (sessionStatus) {
                    sessionStatus.textContent = 'New session started';
                  }
                }

                async function listSessions() {
                  try {
                    const response = await fetch('/api/sessions');
                    const data = await response.json();
                    if (Array.isArray(data.sessions) && data.sessions.length > 0) {
                      addMessage('Sessions: ' + data.sessions.map((s) => s.sessionId).join(', '), 'assistant');
                    } else {
                      addMessage('No saved sessions found.', 'assistant');
                    }
                  } catch (error) {
                    addMessage('Failed to load sessions.', 'assistant');
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
          tools: {
            enabled: true,
            count: this.toolManager.listTools().length
          },
          endpoints: {
            chat: 'POST /api/chat',
            health: 'GET /api/health',
            models: 'GET /api/models',
            session: 'GET /api/session/:id',
            sessions: 'GET /api/sessions',
            tools: 'GET /api/tools',
            'tools/call': 'POST /api/tools/call',
            'tools/logs': 'GET /api/tools/logs',
            'tools/approve': 'POST /api/tools/approve/:id',
            'tools/pending': 'GET /api/tools/pending-approvals'
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
    
    // Streaming chat endpoint (disabled for now)
    /*
    this.app.post('/api/chat/stream', async (req, res) => {
      const { message, sessionId: clientSessionId, createNew = false, model } = req.body;
      
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message is required' });
        return;
      }
      
      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      
      try {
        // Determine session ID
        let sessionId = clientSessionId;
        let isNewSession = false;
        
        if (!sessionId || createNew) {
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
            console.log(`💾 No existing session found for ${sessionId}, starting fresh`);
          }
        }
        
        // Add user message
        const userMessage: Message = {
          role: 'user',
          content: message,
          timestamp: new Date()
        };
        sessionMessages.push(userMessage);
        
        // Send initial metadata
        res.write(`data: ${JSON.stringify({
          type: 'metadata',
          sessionId,
          isNewSession,
          model: model || this.options.model
        })}\n\n`);
        
        // Collect full response for memory
        let fullResponse = '';
        let thinkingContent = '';
        
        // Stream the response
        const stream = this.integration.streamComplete(
          sessionMessages,
          this.systemPrompt,
          undefined,
          model || this.options.model
        );
        
        for await (const { chunk, isThinking, done } of stream) {
          if (chunk) {
            if (isThinking) {
              thinkingContent += chunk;
              res.write(`data: ${JSON.stringify({
                type: 'thinking',
                chunk,
                done: false
              })}\n\n`);
            } else {
              fullResponse += chunk;
              res.write(`data: ${JSON.stringify({
                type: 'response',
                chunk,
                done: false
              })}\n\n`);
            }
          }
          
          if (done) {
            // Add assistant message to memory
            const assistantMessage: Message = {
              role: 'assistant',
              content: fullResponse,
              timestamp: new Date()
            };
            sessionMessages.push(assistantMessage);
            
            // Save session to memory
            if (this.memoryManager) {
              this.memoryManager.saveSession(sessionId, sessionMessages, {
                createdAt: Date.now(),
                lastAccessed: Date.now()
              });
              console.log(`💾 Saved web session: ${sessionId} (${sessionMessages.length} messages)`);
            }
            
            // Send final done event
            res.write(`data: ${JSON.stringify({
              type: 'done',
              thinking: thinkingContent,
              response: fullResponse,
              sessionId,
              model: model || this.options.model
            })}\n\n`);
            
            res.end();
            break;
          }
        }
      } catch (error) {
        console.error('Streaming error:', error);
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        })}\n\n`);
        res.end();
      }
    });
    */
    
    // Chat endpoint with memory integration (regular)
    this.app.post('/api/chat', async (req, res) => {
      console.log(`[WEB] /api/chat received request`);
      const { message, sessionId: clientSessionId, createNew = false, model } = req.body;
      
      console.log(`[WEB] Request body: message="${message?.substring(0, 50)}...", clientSessionId=${clientSessionId || 'none'}, model=${model || 'default'}`);
      
      if (!message || typeof message !== 'string') {
        console.log(`[WEB] Invalid request: no message`);
        res.status(400).json({ error: 'Message is required' });
        return;
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
        
        console.log(`[WEB] Calling integration.complete()...`);
        console.log(`[WEB] System prompt length: ${this.systemPrompt.length}`);
        console.log(`[WEB] System prompt preview: ${this.systemPrompt.substring(0, 100)}...`);
        const result = await this.integration.complete(
          sessionMessages,
          this.systemPrompt,
          undefined, // taskRequirements
          model || this.options.model // forceModel
        );
        
        const responseTime = Date.now() - startTime;
        console.log(`[WEB] Integration completed in ${responseTime}ms`);
        console.log(`[WEB] Result model: ${result.modelUsed}`);
        console.log(`[WEB] Result response length: ${result.response.length}`);
        console.log(`[WEB] Result has thinking tags: ${result.response.includes('<think>')}`);
        
        // Log conversation for personality analysis
        if (this.personalityUpdater) {
          try {
            this.personalityUpdater.logConversation(message, result.response);
            console.log(`🧠 Conversation logged for personality analysis`);
          } catch (error) {
            console.warn('Failed to log conversation for personality analysis:', error);
          }
        }
        
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
        
        // Prepare response
        const responseData = {
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
        };
        
        console.log(`[WEB] Sending response, total size: ${JSON.stringify(responseData).length} bytes`);
        console.log(`[WEB] Response preview: ${result.response.substring(0, 100).replace(/\n/g, '\\n')}...`);
        
        // Send response
        return res.json(responseData);
        
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

    // Tool endpoints
    this.app.get('/api/tools', async (_req, res) => {
      try {
        const tools = this.toolManager.listTools();
        return res.json({
          tools: tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            category: tool.category,
            dangerous: tool.dangerous,
            requiresApproval: tool.requiresApproval,
            parameters: tool.parameters
          }))
        });
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.app.post('/api/tools/call', async (req, res) => {
      const { tool, args, sessionId } = req.body;
      
      if (!tool || typeof tool !== 'string') {
        return res.status(400).json({ error: 'Tool name is required' });
      }
      
      if (!args || typeof args !== 'object') {
        return res.status(400).json({ error: 'Tool arguments are required' });
      }
      
      try {
        const result = await this.toolManager.callTool(tool, args, {
          sessionId: sessionId || `web_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          workspacePath: this.toolManager['options'].workspacePath,
          requireApproval: async (call: ToolCall) => {
            if (this.approvalsDisabled) {
              return true;
            }
            // Store the approval request
            return new Promise((resolve) => {
              const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
              this.pendingApprovals.set(approvalId, { call, resolve });
              
              // In a real implementation, this would trigger a UI notification
              console.log(`[TOOL] Approval required for ${call.tool}:`, call.arguments);
              console.log(`[TOOL] Approval ID: ${approvalId}`);
            });
          },
          logUsage: async (log: ToolUsageLog) => {
            console.log(`[TOOL] ${log.call.tool}: ${log.result.success ? '✅' : '❌'} (${log.result.duration}ms)`);
          }
        });
        
        return res.json(result);
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.app.get('/api/tools/logs', async (req, res) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
        const logs = await this.toolManager.getUsageLog(limit);
        return res.json({ logs });
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.app.post('/api/tools/approve/:id', async (req, res) => {
      const { id } = req.params;
      const { approved } = req.body;
      
      if (typeof approved !== 'boolean') {
        return res.status(400).json({ error: 'Approved flag is required' });
      }
      
      const approval = this.pendingApprovals.get(id);
      if (!approval) {
        return res.status(404).json({ error: 'Approval request not found' });
      }
      
      approval.resolve(approved);
      this.pendingApprovals.delete(id);
      
      return res.json({ success: true, approved });
    });

    this.app.get('/api/tools/pending-approvals', async (_req, res) => {
      const approvals = Array.from(this.pendingApprovals.entries()).map(([id, { call }]) => ({
        id,
        tool: call.tool,
        arguments: call.arguments,
        timestamp: call.timestamp,
        sessionId: call.sessionId
      }));
      
      return res.json({ approvals });
    });

    // Tool configuration endpoints
    this.app.get('/api/tools/config', async (_req, res) => {
      try {
        const configs = this.toolManager.getToolConfigs();
        const tools = this.toolManager.listTools();
        
        // Merge tool definitions with configs
        const merged = tools.map(tool => {
          const config = configs.find(c => c.name === tool.name);
          return {
            ...tool,
            config: config || {
              name: tool.name,
              enabled: true,
              dangerous: tool.dangerous || false,
              requiresApproval: tool.requiresApproval || false
            }
          };
        });
        
        return res.json({ tools: merged });
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.app.put('/api/tools/config/:name', async (req, res) => {
      const { name } = req.params;
      const updates = req.body;
      
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'Updates object required' });
      }
      
      try {
        const updated = this.toolManager.updateToolConfig(name, updates);
        await this.toolManager.saveConfig();
        return res.json({ success: true, config: updated });
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.app.post('/api/tools/config/reset', async (_req, res) => {
      try {
        await this.toolManager.getConfigManager().createDefaultConfig();
        return res.json({ success: true, message: 'Configuration reset to defaults' });
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.app.get('/api/tools/config/export', async (_req, res) => {
      try {
        const config = await this.toolManager.getConfigManager().exportConfig();
        res.setHeader('Content-Disposition', 'attachment; filename="tool-config.json"');
        res.setHeader('Content-Type', 'application/json');
        return res.send(config);
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.app.post('/api/tools/config/import', async (req, res) => {
      const { config } = req.body;
      
      if (!config || typeof config !== 'string') {
        return res.status(400).json({ error: 'Config JSON string required' });
      }
      
      try {
        await this.toolManager.getConfigManager().importConfig(config);
        return res.json({ success: true, message: 'Configuration imported' });
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // AI Tool Calling endpoint
    this.app.post('/api/chat-with-tools', async (req, res) => {
      console.log(`[WEB] /api/chat-with-tools received request`);
      const { message, sessionId: clientSessionId, createNew = false, model } = req.body;
      
      console.log(`[WEB] Request body: message="${message?.substring(0, 50)}...", clientSessionId=${clientSessionId || 'none'}, model=${model || 'default'}`);
      
      if (!message || typeof message !== 'string') {
        console.log(`[WEB] Invalid request: no message`);
        res.status(400).json({ error: 'Message is required' });
        return;
      }
      
      if (!this.toolIntegration) {
        res.status(500).json({ error: 'Tool integration not available' });
        return;
      }
      
      try {
        // Determine session ID
        let sessionId = clientSessionId;
        let isNewSession = false;
        
        if (!sessionId || createNew) {
          sessionId = this.memoryManager ? 
            this.memoryManager.generateSessionId() : 
            `web_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          isNewSession = true;
          console.log(`[WEB] Created new web session: ${sessionId}`);
        }
        
        // Load session messages from memory or start fresh
        let sessionMessages: Message[] = [];
        
        if (this.memoryManager && !createNew) {
          const session = this.memoryManager.loadSession(sessionId);
          if (session) {
            sessionMessages = session.messages;
            console.log(`[WEB] Loaded web session: ${sessionId} (${sessionMessages.length} messages)`);
          } else if (clientSessionId) {
            console.log(`[WEB] No existing session found for ${sessionId}, starting fresh`);
          }
        }
        
        // Add user message
        const userMessage: Message = {
          role: 'user',
          content: message,
          timestamp: new Date()
        };
        sessionMessages.push(userMessage);
        
        // Generate response with tool calling
        const startTime = Date.now();
        console.log(`[WEB] Calling toolIntegration.complete()...`);
        
        const result = await this.toolIntegration.complete(
          sessionMessages,
          this.systemPrompt,
          model || this.options.model
        );
        
        const responseTime = Date.now() - startTime;
        console.log(`[WEB] Tool integration completed in ${responseTime}ms`);
        console.log(`[WEB] Tool calls made: ${result.toolCalls.length}`);
        result.toolCalls.forEach((call, i) => {
          console.log(`[WEB] Tool call ${i + 1}: ${call.tool} - ${call.success ? '✅' : '❌'}`);
        });
        
        // Add assistant message
        const assistantMessage: Message = {
          role: 'assistant',
          content: result.response,
          timestamp: new Date()
        };
        sessionMessages.push(assistantMessage);
        
        // Save session to memory
        if (this.memoryManager) {
          this.memoryManager.saveSession(sessionId, sessionMessages, {
            name: `Web Chat with Tools ${new Date().toLocaleString()}`,
            tags: ['web-ui', 'chat', 'tools'],
            metadata: {
              source: 'web-ui',
              model: this.options.model,
              url: this.options.ollamaUrl,
              toolCalls: result.toolCalls.length
            },
          });
          console.log(`[WEB] Saved web session: ${sessionId} (${sessionMessages.length} messages)`);
        }
        
        // Prepare response
        const responseData = {
          response: result.response,
          toolCalls: result.toolCalls,
          sessionId,
          isNewSession,
          timing: {
            total: responseTime
          },
          model: result.modelUsed,
          memoryEnabled: !!this.memoryManager,
        };
        
        console.log(`[WEB] Sending response with ${result.toolCalls.length} tool calls`);
        
        // Send response
        res.json(responseData);
        console.log(`[WEB] Response sent successfully`);
        
      } catch (error) {
        console.error('[WEB] Chat with tools error:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
          sessionId: clientSessionId || null,
        });
      }
    });
    
    // Phase 1: Agent loop endpoint
    this.app.post('/api/agent/run', async (req, res) => {
      console.log(`[WEB] /api/agent/run received request`);
      const { message, systemPrompt: clientSystemPrompt, model, sessionId: clientSessionId, runId: clientRunId } = req.body;
      
      console.log(`[WEB] Agent request: message="${message?.substring(0, 50)}...", model=${model || 'default'}`);
      
      if (!message || typeof message !== 'string') {
        console.log(`[WEB] Invalid request: no message`);
        res.status(400).json({ error: 'Message is required' });
        return;
      }
      
      if (!this.agentIntegration) {
        res.status(500).json({ error: 'Agent integration not available' });
        return;
      }
      
      try {
        const startTime = Date.now();
        console.log(`[WEB] Starting agent loop...`);
        
        // Use client system prompt or default
        const systemPrompt = clientSystemPrompt || this.systemPrompt;
        const sessionId = clientSessionId || (this.memoryManager?.generateSessionId() ?? `web_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
        
        // Run agent
        const result = await this.agentIntegration.run(
          message,
          systemPrompt,
          {
            sessionId,
            runId: clientRunId,
          }
        );
        
        const responseTime = Date.now() - startTime;
        console.log(`[WEB] Agent completed in ${responseTime}ms`);
        console.log(`[WEB] Tool executions: ${result.toolExecutions.length}`);
        console.log(`[WEB] Turns: ${result.turns}`);
        
        // Convert to response format
        const responseData = {
          response: result.response,
          toolExecutions: result.toolExecutions.map(exec => ({
            tool: exec.toolName,
            success: exec.success,
            result: exec.result,
            error: exec.error,
            duration: exec.duration,
          })),
          messages: result.messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
          })),
          runId: result.runId,
          sessionId: result.sessionId,
          status: result.status,
          stats: {
            turns: result.turns,
            duration: result.duration,
            toolCount: result.toolExecutions.length,
          },
          timing: {
            total: responseTime,
          },
        };
        
        res.json(responseData);
      } catch (error) {
        console.error(`[WEB] Error in /api/agent/run:`, error);
        res.status(500).json({ 
          error: 'Agent execution failed',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Phase 2: Streaming agent endpoint (Server-Sent Events)
    this.app.post('/api/agent/stream', async (req, res) => {
      console.log(`[WEB] /api/agent/stream received request (SSE)`);
      const { message, systemPrompt: clientSystemPrompt, sessionId: clientSessionId, runId: clientRunId } = req.body;
      
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message is required' });
        return;
      }
      
      if (!this.memoryStreamingAgent) {
        res.status(500).json({ error: 'Memory streaming agent not available' });
        return;
      }
      const memoryAgent = this.memoryStreamingAgent;
      
      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      
      const sessionId = clientSessionId || (this.memoryManager?.generateSessionId() ?? `web_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
      const runId = clientRunId || this.runQueue.createRunId();

      // Send initial connection event
      res.write(`event: connected\ndata: ${JSON.stringify({
        status: 'connected',
        sessionId,
        runId,
      })}\n\n`);
      
      // Use client system prompt or default
      const systemPrompt = clientSystemPrompt || this.systemPrompt;
      
      try {
        console.log(`[WEB] Starting streaming agent execution...`);
        
        // Run with memory streaming (serialized per session)
        await this.runQueue.enqueue(
          sessionId,
          async (runMeta) => {
            const controller = new AbortController();
            const timeoutMs = this.agentIntegration?.getAgentLoop().getConfig().timeoutMs || 120000;
            const timeout = setTimeout(() => {
              runMeta.status = 'timeout';
              controller.abort();
            }, timeoutMs);

            try {
              await memoryAgent.runWithMemory(
                message,
                systemPrompt,
                {
                  sessionId,
                  runId,
                  signal: controller.signal,
                  onEvent: (event) => {
                    const sseData = MemoryStreamingAgent.eventToSSE(event);
                    res.write(sseData);
                  },
                }
              );
            } finally {
              clearTimeout(timeout);
            }
          },
          runId
        );
        
        console.log(`[WEB] Streaming agent completed`);
      } catch (error) {
        console.error(`[WEB] Memory streaming agent error:`, error);
        res.write(MemoryStreamingAgent.eventToSSE({
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        }));
      } finally {
        // End the stream
        res.end();
      }
    });
    
    // Phase 2: Steering API endpoints
    this.app.post('/api/agent/queue', async (req, res) => {
      console.log(`[WEB] /api/agent/queue received request`);
      const { message, priority = 'normal', metadata } = req.body;
      
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message is required' });
        return;
      }
      
      if (!this.memoryStreamingAgent) {
        res.status(500).json({ error: 'Memory agent not available' });
        return;
      }
      
      try {
        const queuedMessage: Message = {
          role: 'user',
          content: message,
          timestamp: new Date(),
        };
        
        const messageId = this.memoryStreamingAgent.queueMessage(
          queuedMessage,
          priority as any,
          metadata
        );
        
        console.log(`[WEB] Message queued: ${messageId} with priority ${priority}`);
        
        res.json({
          success: true,
          messageId,
          priority,
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error queuing message:`, error);
        res.status(500).json({ 
          error: 'Failed to queue message',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    this.app.post('/api/agent/interrupt', async (req, res) => {
      console.log(`[WEB] /api/agent/interrupt received request`);
      
      if (!this.memoryStreamingAgent) {
        res.status(500).json({ error: 'Memory agent not available' });
        return;
      }
      
      try {
        const interrupted = this.memoryStreamingAgent.interrupt();
        
        res.json({
          success: interrupted,
          message: interrupted ? 'Agent interrupted' : 'No active agent to interrupt',
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error interrupting agent:`, error);
        res.status(500).json({ 
          error: 'Failed to interrupt agent',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    this.app.get('/api/agent/steering-stats', async (req, res) => {
      console.log(`[WEB] /api/agent/steering-stats requested`);
      
      if (!this.memoryStreamingAgent) {
        res.status(500).json({ error: 'Memory agent not available' });
        return;
      }
      
      try {
        const stats = this.memoryStreamingAgent.getSteeringStats();
        
        res.json({
          success: true,
          stats,
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error getting steering stats:`, error);
        res.status(500).json({ 
          error: 'Failed to get steering statistics',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Phase 3: Memory API endpoints
    this.app.post('/api/agent/memory/search', async (req, res) => {
      console.log(`[WEB] /api/agent/memory/search received request`);
      const { query, limit, minRelevance } = req.body;
      
      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query is required' });
        return;
      }
      
      if (!this.memoryIntegration) {
        res.status(500).json({ error: 'Memory integration not available' });
        return;
      }
      
      try {
        const result = await this.memoryIntegration.searchMemory(query, {
          limit,
          minRelevance,
        });
        
        res.json({
          success: true,
          query,
          context: result.context,
          sessions: result.sessions,
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error searching memory:`, error);
        res.status(500).json({ 
          error: 'Failed to search memory',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    this.app.get('/api/agent/memory/stats', async (req, res) => {
      console.log(`[WEB] /api/agent/memory/stats requested`);
      
      if (!this.memoryIntegration) {
        res.status(500).json({ error: 'Memory integration not available' });
        return;
      }
      
      try {
        const stats = this.memoryIntegration.getStats();
        
        res.json({
          success: true,
          stats,
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error getting memory stats:`, error);
        res.status(500).json({ 
          error: 'Failed to get memory statistics',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    this.app.post('/api/agent/memory/enable', async (req, res) => {
      console.log(`[WEB] /api/agent/memory/enable received request`);
      const { enabled } = req.body;
      
      if (!this.memoryIntegration) {
        res.status(500).json({ error: 'Memory integration not available' });
        return;
      }
      
      try {
        const newState = enabled !== false; // Default to true if not specified
        this.memoryIntegration.setEnabled(newState);
        
        res.json({
          success: true,
          enabled: newState,
          message: `Memory ${newState ? 'enabled' : 'disabled'}`,
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error toggling memory:`, error);
        res.status(500).json({ 
          error: 'Failed to toggle memory',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    this.app.post('/api/agent/memory/clear', async (req, res) => {
      console.log(`[WEB] /api/agent/memory/clear received request`);
      
      if (!this.memoryIntegration) {
        res.status(500).json({ error: 'Memory integration not available' });
        return;
      }
      
      try {
        this.memoryIntegration.clearMemory();
        
        res.json({
          success: true,
          message: 'Memory cleared',
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error clearing memory:`, error);
        res.status(500).json({ 
          error: 'Failed to clear memory',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Personality updater endpoints
    this.app.get('/api/personality/traits', async (req, res) => {
      console.log(`[WEB] /api/personality/traits received request`);
      
      if (!this.personalityUpdater) {
        res.status(500).json({ error: 'Personality updater not available' });
        return;
      }
      
      try {
        const traits = this.personalityUpdater.getCurrentPersonality();
        
        res.json({
          success: true,
          traits,
          count: traits.length,
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error getting personality traits:`, error);
        res.status(500).json({ 
          error: 'Failed to get personality traits',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    this.app.post('/api/personality/update', async (req, res) => {
      console.log(`[WEB] /api/personality/update received request`);
      
      if (!this.personalityUpdater) {
        res.status(500).json({ error: 'Personality updater not available' });
        return;
      }
      
      try {
        this.personalityUpdater.manualUpdate();
        
        res.json({
          success: true,
          message: 'Personality analysis triggered',
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error updating personality:`, error);
        res.status(500).json({ 
          error: 'Failed to update personality',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    this.app.post('/api/personality/clear', async (req, res) => {
      console.log(`[WEB] /api/personality/clear received request`);
      
      if (!this.personalityUpdater) {
        res.status(500).json({ error: 'Personality updater not available' });
        return;
      }
      
      try {
        this.personalityUpdater.clearConversationLog();
        
        res.json({
          success: true,
          message: 'Conversation log cleared',
          timestamp: new Date().toISOString(),
        });
        
      } catch (error) {
        console.error(`[WEB] Error clearing conversation log:`, error);
        res.status(500).json({ 
          error: 'Failed to clear conversation log',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }
  
  async start() {
    // Initialize tool manager async
    await this.toolManager.initialize();
    
    // Check and ensure encryption for sensitive files
    console.log('🔐 Checking encryption status...');
    
    try {
      if (this.fileLoader.isEncryptionAvailable()) {
        console.log('✅ Encryption available - ensuring sensitive files are encrypted');
        await this.fileLoader.ensureEncryptedFiles();
      } else {
        console.log('⚠️  Encryption not configured - sensitive files will be stored in plain text');
        console.log('   Run `scripts/secure-install.sh` to enable encryption');
      }
    } catch (error) {
      console.log('⚠️  Encryption check failed:', error instanceof Error ? error.message : String(error));
    }
    
    // Load identity files
    console.log('📚 Loading identity files...');
    
    try {
      this.systemPrompt = await this.fileLoader.constructSystemPrompt();
      console.log('✅ Identity loaded from SOUL.md, USER.md, and memory files');
      console.log(`   System prompt length: ${this.systemPrompt.length}`);
      
      // If system prompt is too short, use basic fallback
      if (this.systemPrompt.length < 1000) {
        console.warn(`⚠️  System prompt too short (${this.systemPrompt.length} chars), using basic fallback`);
        
        // Read SOUL.md directly
        try {
          const fs = await import('fs');
          const path = await import('path');
          const soulPath = path.join(this.identityPath, 'SOUL.md');
          const userPath = path.join(this.identityPath, 'USER.md');
          
          let soulContent = '';
          let userContent = '';
          
          if (fs.existsSync(soulPath)) {
            soulContent = fs.readFileSync(soulPath, 'utf-8');
            console.log(`   Direct SOUL.md read: ${soulContent.length} chars`);
          }
          
          if (fs.existsSync(userPath)) {
            userContent = fs.readFileSync(userPath, 'utf-8');
            console.log(`   Direct USER.md read: ${userContent.length} chars`);
          }
          
          // Construct full system prompt manually
          const parts: string[] = [];
          
          if (soulContent) {
            parts.push(soulContent);
          } else {
            // Basic fallback prompt
            parts.push(`# Assistant Identity

You are a helpful AI assistant running in OpenClaw Lite.

## Core Principles

- Be genuinely helpful and resourceful
- Use available tools when appropriate
- Respect privacy and boundaries
- When in doubt about external actions, ask first
- Keep responses concise but thorough when needed`);
          }
          
          if (userContent) {
            parts.push(`\n## About the person you're helping:\n${userContent}`);
          }
          
          // Add instructions
          parts.push(`
## Instructions:
- Be resourceful: try to figure things out before asking
- Have opinions and personality (based on SOUL.md)
- Respect privacy and boundaries
- When in doubt about external actions, ask first
- Use available tools when appropriate
- Keep responses concise but thorough when needed
`);
          
          this.systemPrompt = parts.join('\n');
          console.log(`   New system prompt length: ${this.systemPrompt.length}`);
          
        } catch (e) {
          console.warn('   Could not read files directly:', e instanceof Error ? e.message : String(e));
        }
      }
      
    } catch (error) {
      console.log('⚠️  Could not load identity files:', error instanceof Error ? error.message : String(error));
      console.log('   Using default system prompt');
      this.systemPrompt = this.options.systemPrompt || 'You are a helpful AI assistant.';
    }
    
    // Check Ollama health
    if (process.env.OPENCLAW_LITE_SKIP_OLLAMA_CHECK === '1') {
      console.log('\n⚠️  Skipping Ollama health check (OPENCLAW_LITE_SKIP_OLLAMA_CHECK=1)');
    } else {
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
        
        // Warm up the model
        this.warmUpModel().catch(error => {
          console.warn('Model warm-up failed:', error.message);
        });
        
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
  
  private async warmUpModel(): Promise<void> {
    console.log('🔥 Warming up model...');
    try {
      // Send a simple prompt to load the model into VRAM
      // Use the actual system prompt (Ada persona) not a generic one
      const warmUpResult = await this.integration.complete(
        [{ role: 'user', content: 'Hello', timestamp: new Date() }],
        this.systemPrompt, // Use the actual system prompt with Ada persona
        undefined,
        this.options.model
      );
      console.log(`✅ Model warmed up (${warmUpResult.timing?.total || 0}ms)`);
    } catch (error) {
      console.warn('⚠️  Model warm-up failed:', error instanceof Error ? error.message : String(error));
    }
  }
}

// Export a simple start function
export async function startWebServer(options: WebServerOptions = {}) {
  const server = new WebServer(options);
  await server.start();
  return server;
}