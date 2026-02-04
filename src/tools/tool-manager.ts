import fs from 'fs/promises';
import path from 'path';
import { exec as childProcessExec } from 'child_process';
import { promisify } from 'util';
import type {
  ToolDefinition,
  ToolHandler,
  ToolContext,
  ToolCall,
  ToolResult,
  ToolUsageLog,
  ToolRegistry
} from './types.js';
import { ToolConfigManager } from './tool-config.js';

const exec = promisify(childProcessExec);

export class ToolManager implements ToolRegistry {
  private tools: Map<string, { definition: ToolDefinition; handler: ToolHandler }> = new Map();
  private usageLog: ToolUsageLog[] = [];
  private configManager: ToolConfigManager;

  constructor(private options: {
    workspacePath: string;
    requireApprovalForDangerous?: boolean;
    maxLogSize?: number;
    configPath?: string;
  }) {
    const configPath = options.configPath || path.join(process.env.HOME || '.', '.openclaw-lite', 'config', 'tool-config.json');
    this.configManager = new ToolConfigManager({
      configPath,
      defaultDangerousTools: [] // Empty - no tools dangerous by default
    });
    
    this.registerDefaultTools();
  }

  async initialize(): Promise<void> {
    await this.configManager.loadConfig();
    console.log(`[Tool Manager] Initialized with ${this.tools.size} tools`);
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  unregisterTool(name: string): void {
    this.tools.delete(name);
  }

  getTool(name: string): { definition: ToolDefinition; handler: ToolHandler } | null {
    return this.tools.get(name) || null;
  }

  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  async callTool(name: string, args: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    // Check if tool is enabled
    if (!this.configManager.isToolEnabled(name)) {
      throw new Error(`Tool is disabled: ${name}`);
    }

    const callId = `tool_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const call: ToolCall = {
      id: callId,
      tool: name,
      arguments: args,
      timestamp: new Date(),
      sessionId: context.sessionId,
      userId: context.userId
    };

    const startTime = Date.now();
    
    try {
      // Check if approval is required (from config or definition)
      const requiresApproval = this.configManager.requiresApproval(name) || 
                              (tool.definition.dangerous && this.options.requireApprovalForDangerous);
      
      if (requiresApproval) {
        if (context.requireApproval) {
          const approved = await context.requireApproval(call);
          if (!approved) {
            throw new Error(`Tool execution not approved: ${name}`);
          }
        } else {
          throw new Error(`Approval required but no approval handler provided for: ${name}`);
        }
      }

      // Execute tool
      const result = await tool.handler(args, {
        ...context,
        workspacePath: this.options.workspacePath
      });

      const duration = Date.now() - startTime;
      const toolResult: ToolResult = {
        callId,
        success: true,
        result,
        duration,
        timestamp: new Date()
      };

      // Log usage
      await this.logUsage({
        call,
        result: toolResult,
        approved: true
      });

      return toolResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      const toolResult: ToolResult = {
        callId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
        timestamp: new Date()
      };

      // Log usage even on error
      await this.logUsage({
        call,
        result: toolResult,
        approved: true
      });

      return toolResult;
    }
  }

  async getUsageLog(limit?: number): Promise<ToolUsageLog[]> {
    const logs = [...this.usageLog].sort((a, b) => 
      b.call.timestamp.getTime() - a.call.timestamp.getTime()
    );
    return limit ? logs.slice(0, limit) : logs;
  }

  clearUsageLog(): void {
    this.usageLog = [];
  }

  // Config management
  getConfigManager(): ToolConfigManager {
    return this.configManager;
  }

  async reloadConfig(): Promise<void> {
    await this.configManager.loadConfig();
  }

  async saveConfig(): Promise<void> {
    await this.configManager.saveConfig();
  }

  getToolConfigs() {
    return this.configManager.getAllConfigs();
  }

  updateToolConfig(toolName: string, updates: any) {
    return this.configManager.updateToolConfig(toolName, updates);
  }

  private async logUsage(log: ToolUsageLog): Promise<void> {
    this.usageLog.push(log);
    
    // Trim log if it exceeds max size
    if (this.options.maxLogSize && this.usageLog.length > this.options.maxLogSize) {
      this.usageLog = this.usageLog.slice(-this.options.maxLogSize);
    }
  }

  private registerDefaultTools(): void {
    // File read tool
    this.registerTool({
      name: 'read',
      description: 'Read the contents of a file',
      category: 'file',
      parameters: {
        path: {
          type: 'string',
          description: 'Path to the file to read (relative to workspace)',
          required: true
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed)',
          required: false
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read',
          required: false
        }
      },
      returns: {
        type: 'string',
        description: 'File contents'
      }
    }, this.handleRead.bind(this));

    // File write tool
    this.registerTool({
      name: 'write',
      description: 'Write content to a file (creates or overwrites)',
      category: 'file',
      dangerous: true,
      requiresApproval: true,
      parameters: {
        path: {
          type: 'string',
          description: 'Path to the file to write (relative to workspace)',
          required: true
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
          required: true
        }
      },
      returns: {
        type: 'void',
        description: 'Success indicator'
      }
    }, this.handleWrite.bind(this));

    // File edit tool
    this.registerTool({
      name: 'edit',
      description: 'Make precise edits to a file by replacing exact text',
      category: 'file',
      dangerous: true,
      requiresApproval: true,
      parameters: {
        path: {
          type: 'string',
          description: 'Path to the file to edit (relative to workspace)',
          required: true
        },
        oldText: {
          type: 'string',
          description: 'Exact text to find and replace (must match exactly)',
          required: true
        },
        newText: {
          type: 'string',
          description: 'New text to replace the old text with',
          required: true
        }
      },
      returns: {
        type: 'void',
        description: 'Success indicator'
      }
    }, this.handleEdit.bind(this));

    // List directory tool
    this.registerTool({
      name: 'list',
      description: 'List files and directories in a path',
      category: 'file',
      parameters: {
        path: {
          type: 'string',
          description: 'Path to list (relative to workspace, defaults to workspace root)',
          required: false,
          default: '.'
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively',
          required: false,
          default: false
        }
      },
      returns: {
        type: 'array',
        description: 'Array of file/directory entries'
      }
    }, this.handleList.bind(this));

    // Execute command tool
    this.registerTool({
      name: 'exec',
      description: 'Execute shell commands',
      category: 'system',
      dangerous: true,
      requiresApproval: true,
      parameters: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
          required: true
        },
        workdir: {
          type: 'string',
          description: 'Working directory (relative to workspace)',
          required: false,
          default: '.'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds',
          required: false,
          default: 30
        }
      },
      returns: {
        type: 'object',
        description: 'Command execution result'
      }
    }, this.handleExec.bind(this));

    // Git status tool
    this.registerTool({
      name: 'git_status',
      description: 'Check git repository status',
      category: 'git',
      parameters: {
        path: {
          type: 'string',
          description: 'Path to git repository (relative to workspace)',
          required: false,
          default: '.'
        }
      },
      returns: {
        type: 'object',
        description: 'Git status information'
      }
    }, this.handleGitStatus.bind(this));

    // Git log tool
    this.registerTool({
      name: 'git_log',
      description: 'Show git commit history',
      category: 'git',
      parameters: {
        path: {
          type: 'string',
          description: 'Path to git repository (relative to workspace)',
          required: false,
          default: '.'
        },
        limit: {
          type: 'number',
          description: 'Number of commits to show',
          required: false,
          default: 10
        }
      },
      returns: {
        type: 'array',
        description: 'Git commit history'
      }
    }, this.handleGitLog.bind(this));

    // Search files tool
    this.registerTool({
      name: 'search',
      description: 'Search for text in files',
      category: 'file',
      parameters: {
        pattern: {
          type: 'string',
          description: 'Search pattern (supports basic glob patterns)',
          required: true
        },
        path: {
          type: 'string',
          description: 'Path to search in (relative to workspace)',
          required: false,
          default: '.'
        },
        recursive: {
          type: 'boolean',
          description: 'Search recursively',
          required: false,
          default: true
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive search',
          required: false,
          default: false
        }
      },
      returns: {
        type: 'array',
        description: 'Search results'
      }
    }, this.handleSearch.bind(this));

    // Create directory tool
    this.registerTool({
      name: 'mkdir',
      description: 'Create a directory',
      category: 'file',
      parameters: {
        path: {
          type: 'string',
          description: 'Path to create (relative to workspace)',
          required: true
        },
        recursive: {
          type: 'boolean',
          description: 'Create parent directories if needed',
          required: false,
          default: true
        }
      },
      returns: {
        type: 'void',
        description: 'Success indicator'
      }
    }, this.handleMkdir.bind(this));

    // Delete file/directory tool
    this.registerTool({
      name: 'delete',
      description: 'Delete a file or directory',
      category: 'file',
      dangerous: true,
      requiresApproval: true,
      parameters: {
        path: {
          type: 'string',
          description: 'Path to delete (relative to workspace)',
          required: true
        },
        recursive: {
          type: 'boolean',
          description: 'Delete directories recursively',
          required: false,
          default: false
        }
      },
      returns: {
        type: 'void',
        description: 'Success indicator'
      }
    }, this.handleDelete.bind(this));

    // Copy file tool
    this.registerTool({
      name: 'copy',
      description: 'Copy a file or directory',
      category: 'file',
      parameters: {
        source: {
          type: 'string',
          description: 'Source path (relative to workspace)',
          required: true
        },
        destination: {
          type: 'string',
          description: 'Destination path (relative to workspace)',
          required: true
        },
        recursive: {
          type: 'boolean',
          description: 'Copy directories recursively',
          required: false,
          default: false
        }
      },
      returns: {
        type: 'void',
        description: 'Success indicator'
      }
    }, this.handleCopy.bind(this));

    // Move/rename tool
    this.registerTool({
      name: 'move',
      description: 'Move or rename a file or directory',
      category: 'file',
      dangerous: true,
      requiresApproval: true,
      parameters: {
        source: {
          type: 'string',
          description: 'Source path (relative to workspace)',
          required: true
        },
        destination: {
          type: 'string',
          description: 'Destination path (relative to workspace)',
          required: true
        }
      },
      returns: {
        type: 'void',
        description: 'Success indicator'
      }
    }, this.handleMove.bind(this));

    // Get file info tool
    this.registerTool({
      name: 'file_info',
      description: 'Get information about a file or directory',
      category: 'file',
      parameters: {
        path: {
          type: 'string',
          description: 'Path to examine (relative to workspace)',
          required: true
        }
      },
      returns: {
        type: 'object',
        description: 'File information'
      }
    }, this.handleFileInfo.bind(this));

    // HTTP request tool
    this.registerTool({
      name: 'http_request',
      description: 'Make HTTP requests (GET, POST, PUT, DELETE)',
      category: 'network',
      parameters: {
        url: {
          type: 'string',
          description: 'URL to request',
          required: true
        },
        method: {
          type: 'string',
          description: 'HTTP method (GET, POST, PUT, DELETE, etc.)',
          required: false,
          default: 'GET'
        },
        headers: {
          type: 'object',
          description: 'HTTP headers as key-value pairs',
          required: false
        },
        body: {
          type: 'string',
          description: 'Request body (for POST/PUT)',
          required: false
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds',
          required: false,
          default: 30
        }
      },
      returns: {
        type: 'object',
        description: 'HTTP response'
      }
    }, this.handleHttpRequest.bind(this));

    // Create script tool
    this.registerTool({
      name: 'create_script',
      description: 'Create a script file with executable permissions',
      category: 'file',
      dangerous: true,
      requiresApproval: true,
      parameters: {
        path: {
          type: 'string',
          description: 'Path to script file (relative to workspace)',
          required: true
        },
        content: {
          type: 'string',
          description: 'Script content',
          required: true
        },
        interpreter: {
          type: 'string',
          description: 'Script interpreter (e.g., bash, python, node)',
          required: false,
          default: 'bash'
        }
      },
      returns: {
        type: 'void',
        description: 'Success indicator'
      }
    }, this.handleCreateScript.bind(this));

    // Environment variables tool
    this.registerTool({
      name: 'env',
      description: 'Read environment variables',
      category: 'system',
      parameters: {
        name: {
          type: 'string',
          description: 'Environment variable name (optional, returns all if not specified)',
          required: false
        }
      },
      returns: {
        type: 'object',
        description: 'Environment variable(s)'
      }
    }, this.handleEnv.bind(this));

    // Process list tool
    this.registerTool({
      name: 'ps',
      description: 'List running processes',
      category: 'system',
      parameters: {
        user: {
          type: 'string',
          description: 'Filter by user (optional)',
          required: false
        },
        search: {
          type: 'string',
          description: 'Search process names (optional)',
          required: false
        },
        limit: {
          type: 'number',
          description: 'Maximum number of processes to return',
          required: false,
          default: 50
        }
      },
      returns: {
        type: 'array',
        description: 'List of processes'
      }
    }, this.handlePs.bind(this));

    // Kill process tool
    this.registerTool({
      name: 'kill',
      description: 'Terminate a running process',
      category: 'system',
      dangerous: true,
      requiresApproval: true,
      parameters: {
        pid: {
          type: 'number',
          description: 'Process ID to kill',
          required: true
        },
        signal: {
          type: 'string',
          description: 'Signal to send (TERM, KILL, INT, etc.)',
          required: false,
          default: 'TERM'
        }
      },
      returns: {
        type: 'object',
        description: 'Kill result'
      }
    }, this.handleKill.bind(this));
  }

  private async handleRead(args: Record<string, any>, context: ToolContext): Promise<string> {
    const filePath = this.resolvePath(args.path, context.workspacePath);
    
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File not found: ${args.path}`);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    
    if (args.offset !== undefined || args.limit !== undefined) {
      const lines = content.split('\n');
      const start = args.offset ? Math.max(0, args.offset - 1) : 0;
      const end = args.limit ? start + args.limit : lines.length;
      return lines.slice(start, end).join('\n');
    }
    
    return content;
  }

  private async handleWrite(args: Record<string, any>, context: ToolContext): Promise<void> {
    const filePath = this.resolvePath(args.path, context.workspacePath);
    
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(filePath, args.content, 'utf-8');
  }

  private async handleEdit(args: Record<string, any>, context: ToolContext): Promise<void> {
    const filePath = this.resolvePath(args.path, context.workspacePath);
    
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch {
      throw new Error(`File not found: ${args.path}`);
    }

    if (!content.includes(args.oldText)) {
      throw new Error('Old text not found in file');
    }

    const newContent = content.replace(args.oldText, args.newText);
    await fs.writeFile(filePath, newContent, 'utf-8');
  }

  private async handleList(args: Record<string, any>, context: ToolContext): Promise<any[]> {
    const listPath = args.path ? this.resolvePath(args.path, context.workspacePath) : context.workspacePath;
    
    try {
      await fs.access(listPath);
    } catch {
      throw new Error(`Path not found: ${args.path || '.'}`);
    }

    const entries = await fs.readdir(listPath, { withFileTypes: true });
    
    if (!args.recursive) {
      return entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        path: path.relative(context.workspacePath, path.join(listPath, entry.name))
      }));
    }

    // Recursive listing
    const result: any[] = [];
    const stack: { path: string; depth: number }[] = [{ path: listPath, depth: 0 }];
    
    while (stack.length > 0) {
      const current = stack.pop()!;
      const entries = await fs.readdir(current.path, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = path.join(current.path, entry.name);
        const relativePath = path.relative(context.workspacePath, entryPath);
        
        result.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          path: relativePath,
          depth: current.depth
        });
        
        if (entry.isDirectory()) {
          stack.push({ path: entryPath, depth: current.depth + 1 });
        }
      }
    }
    
    return result;
  }

  private async handleExec(args: Record<string, any>, context: ToolContext): Promise<{ stdout: string; stderr: string; code: number }> {
    const workdir = args.workdir ? this.resolvePath(args.workdir, context.workspacePath) : context.workspacePath;
    
    try {
      await fs.access(workdir);
    } catch {
      throw new Error(`Working directory not found: ${args.workdir}`);
    }

    try {
      const { stdout, stderr } = await exec(args.command, {
        cwd: workdir,
        timeout: (args.timeout || 30) * 1000,
        shell: '/bin/bash'
      });
      
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code: 0
      };
    } catch (error: any) {
      return {
        stdout: error.stdout?.toString()?.trim() || '',
        stderr: error.stderr?.toString()?.trim() || error.message,
        code: error.code || 1
      };
    }
  }

  private async handleGitStatus(args: Record<string, any>, context: ToolContext): Promise<any> {
    const gitPath = args.path ? this.resolvePath(args.path, context.workspacePath) : context.workspacePath;
    
    try {
      const { stdout } = await exec('git status --porcelain', {
        cwd: gitPath,
        timeout: 10000
      });
      
      const { stdout: branchStdout } = await exec('git branch --show-current', {
        cwd: gitPath,
        timeout: 5000
      });
      
      return {
        branch: branchStdout.trim(),
        status: stdout.trim().split('\n').filter(line => line.trim()),
        hasChanges: stdout.trim().length > 0
      };
    } catch (error: any) {
      return {
        error: error.stderr?.toString() || error.message,
        isGitRepo: false
      };
    }
  }

  private async handleGitLog(args: Record<string, any>, context: ToolContext): Promise<any[]> {
    const gitPath = args.path ? this.resolvePath(args.path, context.workspacePath) : context.workspacePath;
    const limit = args.limit || 10;
    
    try {
      const { stdout } = await exec(`git log --oneline -n ${limit}`, {
        cwd: gitPath,
        timeout: 10000
      });
      
      return stdout.trim().split('\n').map(line => {
        const [hash, ...message] = line.split(' ');
        return {
          hash: hash || '',
          message: message.join(' ') || ''
        };
      });
    } catch (error: any) {
      throw new Error(`Git log failed: ${error.stderr?.toString() || error.message}`);
    }
  }

  private async handleSearch(args: Record<string, any>, context: ToolContext): Promise<any[]> {
    const searchPath = args.path ? this.resolvePath(args.path, context.workspacePath) : context.workspacePath;
    const pattern = args.pattern;
    const recursive = args.recursive !== false;
    const caseSensitive = args.caseSensitive === true;
    
    try {
      // Use find and grep for simple search
      let findCmd = `find "${searchPath}" -type f`;
      if (!recursive) {
        findCmd = `find "${searchPath}" -maxdepth 1 -type f`;
      }
      
      const grepFlags = caseSensitive ? '' : '-i';
      const { stdout } = await exec(`${findCmd} -exec grep -l ${grepFlags} "${pattern}" {} \\;`, {
        cwd: context.workspacePath,
        timeout: 30000,
        shell: '/bin/bash'
      });
      
      const files = stdout.trim().split('\n').filter(f => f.trim());
      return files.map(file => ({
        path: path.relative(context.workspacePath, file),
        matches: true
      }));
    } catch (error: any) {
      // grep returns non-zero exit code when no matches found
      if (error.code === 1) {
        return [];
      }
      throw new Error(`Search failed: ${error.stderr?.toString() || error.message}`);
    }
  }

  private async handleMkdir(args: Record<string, any>, context: ToolContext): Promise<void> {
    const dirPath = this.resolvePath(args.path, context.workspacePath);
    const recursive = args.recursive !== false;
    
    await fs.mkdir(dirPath, { recursive });
  }

  private async handleDelete(args: Record<string, any>, context: ToolContext): Promise<void> {
    const targetPath = this.resolvePath(args.path, context.workspacePath);
    const recursive = args.recursive === true;
    
    try {
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        if (recursive) {
          await fs.rm(targetPath, { recursive: true, force: true });
        } else {
          await fs.rmdir(targetPath);
        }
      } else {
        await fs.unlink(targetPath);
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`Path not found: ${args.path}`);
      }
      throw error;
    }
  }

  private async handleCopy(args: Record<string, any>, context: ToolContext): Promise<void> {
    const sourcePath = this.resolvePath(args.source, context.workspacePath);
    const destPath = this.resolvePath(args.destination, context.workspacePath);
    const recursive = args.recursive === true;
    
    try {
      await fs.access(sourcePath);
    } catch {
      throw new Error(`Source not found: ${args.source}`);
    }
    
    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      if (recursive) {
        await fs.cp(sourcePath, destPath, { recursive: true });
      } else {
        throw new Error('Cannot copy directory without recursive flag');
      }
    } else {
      await fs.copyFile(sourcePath, destPath);
    }
  }

  private async handleMove(args: Record<string, any>, context: ToolContext): Promise<void> {
    const sourcePath = this.resolvePath(args.source, context.workspacePath);
    const destPath = this.resolvePath(args.destination, context.workspacePath);
    
    try {
      await fs.access(sourcePath);
    } catch {
      throw new Error(`Source not found: ${args.source}`);
    }
    
    await fs.rename(sourcePath, destPath);
  }

  private async handleFileInfo(args: Record<string, any>, context: ToolContext): Promise<any> {
    const filePath = this.resolvePath(args.path, context.workspacePath);
    
    try {
      const stat = await fs.stat(filePath);
      return {
        path: args.path,
        exists: true,
        type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
        size: stat.size,
        created: stat.birthtime,
        modified: stat.mtime,
        accessed: stat.atime,
        permissions: stat.mode.toString(8).slice(-3)
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          path: args.path,
          exists: false
        };
      }
      throw error;
    }
  }

  private async handleHttpRequest(args: Record<string, any>, _context: ToolContext): Promise<any> {
    const { url, method = 'GET', headers = {}, body, timeout = 30 } = args;
    
    try {
      // Use axios for HTTP requests
      const axios = await import('axios');
      
      const response = await axios.default({
        url,
        method: method.toUpperCase(),
        headers: {
          'User-Agent': 'OpenClaw-Lite/1.0',
          ...headers
        },
        data: body,
        timeout: timeout * 1000,
        validateStatus: () => true // Don't throw on HTTP errors
      });
      
      return {
        url,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.data,
        ok: response.status >= 200 && response.status < 300
      };
    } catch (error: any) {
      throw new Error(`HTTP request failed: ${error.message}`);
    }
  }

  private async handleCreateScript(args: Record<string, any>, context: ToolContext): Promise<void> {
    const filePath = this.resolvePath(args.path, context.workspacePath);
    const content = args.content;
    const interpreter = args.interpreter || 'bash';
    
    // Add shebang based on interpreter
    let scriptContent = '';
    if (interpreter === 'bash') {
      scriptContent = `#!/bin/bash\n\n${content}`;
    } else if (interpreter === 'python') {
      scriptContent = `#!/usr/bin/env python3\n\n${content}`;
    } else if (interpreter === 'node') {
      scriptContent = `#!/usr/bin/env node\n\n${content}`;
    } else {
      scriptContent = content;
    }
    
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write script
    await fs.writeFile(filePath, scriptContent, 'utf-8');
    
    // Make executable
    await fs.chmod(filePath, 0o755);
  }

  private async handleEnv(args: Record<string, any>, context: ToolContext): Promise<any> {
    const name = args.name;
    
    if (name) {
      return {
        [name]: process.env[name] || null
      };
    } else {
      // Return all environment variables (filtered for security)
      const safeEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value && !key.toLowerCase().includes('password') && !key.toLowerCase().includes('secret')) {
          safeEnv[key] = value;
        }
      }
      return safeEnv;
    }
  }

  private async handlePs(args: Record<string, any>, context: ToolContext): Promise<any[]> {
    const { user, search, limit = 50 } = args;
    
    try {
      // Use ps command to list processes
      let psCmd = 'ps aux';
      if (user) {
        psCmd = `ps -u ${user}`;
      }
      
      const { stdout } = await exec(psCmd, {
        timeout: 10000
      });
      
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) {
        return [];
      }
      
      // Parse headers line (not used directly but needed for structure)
      lines[0].split(/\s+/);
      const processes = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(/\s+/);
        
        if (parts.length < 11) continue;
        
        const pid = parseInt(parts[1], 10) || 0;
        const command = parts.slice(10).join(' ') || '';
        
        processes.push({
          pid,
          user: parts[0] || '',
          cpu: parts[2] || '',
          mem: parts[3] || '',
          vsz: parts[4] || '',
          rss: parts[5] || '',
          tty: parts[6] || '',
          stat: parts[7] || '',
          start: parts[8] || '',
          time: parts[9] || '',
          command,
          fullLine: line
        });
      }
      
      // Apply search filter
      let filtered = processes;
      if (search) {
        const searchLower = search.toLowerCase();
        filtered = processes.filter(p => 
          p.command.toLowerCase().includes(searchLower) ||
          p.user.toLowerCase().includes(searchLower)
        );
      }
      
      // Apply limit
      return filtered.slice(0, limit);
      
    } catch (error: any) {
      throw new Error(`Failed to list processes: ${error.message}`);
    }
  }

  private async handleKill(args: Record<string, any>, _context: ToolContext): Promise<any> {
    const { pid, signal = 'TERM' } = args;
    
    if (!pid || typeof pid !== 'number') {
      throw new Error('Valid PID required');
    }
    
    try {
      // Check if process exists
      await exec(`ps -p ${pid}`, { timeout: 5000 });
      
      // Kill the process
      const { stdout, stderr } = await exec(`kill -${signal} ${pid}`, {
        timeout: 10000
      });
      
      return {
        success: true,
        pid,
        signal,
        message: `Process ${pid} sent signal ${signal}`,
        stdout: stdout || '',
        stderr: stderr || ''
      };
      
    } catch (error: any) {
      if (error.code === 1) {
        throw new Error(`Process ${pid} not found`);
      }
      throw new Error(`Failed to kill process: ${error.message}`);
    }
  }

  private resolvePath(userPath: string, workspacePath: string): string {
    const resolved = path.resolve(workspacePath, userPath);
    
    // Security check: ensure path is within workspace
    if (!resolved.startsWith(path.resolve(workspacePath))) {
      throw new Error(`Path traversal attempt detected: ${userPath}`);
    }
    
    return resolved;
  }
}