import type { ToolManager } from '../tools/tool-manager.js';
import type { ToolDefinition, ToolExecutionResult } from './types.js';

/**
 * Bridge between AgentLoop and ToolManager
 * Handles tool execution with proper error handling and context
 */
export class ToolBridge {
  constructor(
    private toolManager: ToolManager,
    private options: {
      workspacePath?: string;
      requireApprovalForDangerous?: boolean;
      autoApproveTimeout?: number;
    } = {}
  ) {}
  
  /**
   * Get tool definitions from ToolManager
   */
  async getToolDefinitions(): Promise<ToolDefinition[]> {
    await this.toolManager.initialize();
    const tools = this.toolManager.listTools();
    
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description || `Execute ${tool.name} tool`,
      parameters: tool.parameters || {
        type: 'object',
        properties: {},
        required: [],
      },
    }));
  }
  
  /**
   * Execute a tool call
   */
  async executeTool(
    toolName: string,
    args: Record<string, any>,
    context: {
      sessionId?: string;
      toolCallId?: string;
      startTime?: number;
    }
  ): Promise<any> {
    const sessionId = context.sessionId || 'agent-session';
    const startTime = context.startTime || Date.now();
    
    console.log(`[ToolBridge] Executing tool: ${toolName}`, args);
    
    try {
      // Check if tool exists
      const tool = this.toolManager.getTool(toolName);
      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }
      
      // Check if tool requires approval
      if (tool.definition.requiresApproval) {
        console.log(`[ToolBridge] Tool ${toolName} requires approval, checking...`);
        // For Phase 1, auto-approve after timeout
        // In Phase 2, implement proper approval system
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Create execution context
      const executionContext = {
        sessionId,
        workspacePath: this.options.workspacePath || process.cwd(),
        toolCallId: context.toolCallId,
      };
      
      // Execute tool
      const result = await this.toolManager.callTool(toolName, args, executionContext);
      
      if (!result.success) {
        throw new Error(result.error || `Tool ${toolName} execution failed`);
      }
      
      console.log(`[ToolBridge] Tool ${toolName} executed successfully`);
      return result.result;
      
    } catch (error) {
      console.error(`[ToolBridge] Tool execution failed:`, error);
      throw error;
    }
  }
  
  /**
   * Create a tool execution callback for AgentLoop
   */
  createToolExecutionCallback(sessionId: string = 'agent-session') {
    return async (
      toolName: string,
      args: any,
      context: { toolCallId?: string; startTime?: number }
    ): Promise<any> => {
      return this.executeTool(toolName, args, {
        sessionId,
        ...context,
      });
    };
  }
  
  /**
   * Get tool execution statistics
   */
  async getStats(): Promise<{
    totalTools: number;
    enabledTools: number;
    dangerousTools: number;
    toolsRequiringApproval: number;
  }> {
    await this.toolManager.initialize();
    const tools = this.toolManager.listTools();
    
    // For Phase 1, assume all tools are enabled
    // In Phase 2, we'll check the ToolConfigManager
    return {
      totalTools: tools.length,
      enabledTools: tools.length, // All enabled for now
      dangerousTools: tools.filter(t => t.dangerous).length,
      toolsRequiringApproval: tools.filter(t => t.requiresApproval).length,
    };
  }
  
  /**
   * Update tool configuration
   */
  async updateToolConfig(
    toolName: string,
    config: {
      enabled?: boolean;
      dangerous?: boolean;
      requiresApproval?: boolean;
    }
  ): Promise<boolean> {
    try {
      // This would update the ToolConfigManager
      // For Phase 1, just log
      console.log(`[ToolBridge] Would update tool ${toolName} config:`, config);
      return true;
    } catch (error) {
      console.error(`[ToolBridge] Failed to update tool config:`, error);
      return false;
    }
  }
}