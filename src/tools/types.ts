export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  returns: ToolReturn;
  dangerous?: boolean;
  requiresApproval?: boolean;
  category?: 'file' | 'system' | 'network' | 'skill' | 'git';
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  default?: any;
}

export interface ToolReturn {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'void';
  description: string;
}

export interface ToolCall {
  id: string;
  tool: string;
  arguments: Record<string, any>;
  timestamp: Date;
  sessionId: string;
  userId?: string;
}

export interface ToolResult {
  callId: string;
  success: boolean;
  result?: any;
  error?: string;
  duration: number;
  timestamp: Date;
}

export interface ToolUsageLog {
  call: ToolCall;
  result: ToolResult;
  approved?: boolean;
  approvedBy?: string;
  approvedAt?: Date;
}

export type ToolHandler = (args: Record<string, any>, context: ToolContext) => Promise<any>;

export interface ToolContext {
  sessionId: string;
  userId?: string;
  workspacePath: string;
  requireApproval?: (call: ToolCall) => Promise<boolean>;
  logUsage?: (log: ToolUsageLog) => Promise<void>;
}

export interface ToolRegistry {
  registerTool(definition: ToolDefinition, handler: ToolHandler): void;
  unregisterTool(name: string): void;
  getTool(name: string): { definition: ToolDefinition; handler: ToolHandler } | null;
  listTools(): ToolDefinition[];
  callTool(name: string, args: Record<string, any>, context: ToolContext): Promise<ToolResult>;
}