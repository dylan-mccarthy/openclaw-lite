import type { Message } from '../context/types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
}

export interface AgentContext {
  messages: Message[];
  systemPrompt: string;
  tools: ToolDefinition[];
  config: AgentConfig;
}

export interface AgentConfig {
  model: string;
  temperature?: number;
  maxToolCalls?: number;
  maxTurns?: number;
  timeoutMs?: number;
  allowDangerousTools?: boolean;
  requireApproval?: boolean;
}

export interface AgentEvent {
  type: 'agent_start' | 'agent_end' | 
        'turn_start' | 'turn_end' |
        'message_start' | 'message_end' | 'message_update' |
        'tool_execution_start' | 'tool_result' | 'tool_error' |
        'thinking_start' | 'thinking_delta' | 'thinking_end' |
        'memory_search' | 'memory_save' |
        'error' | 'warning';
  
  // Event-specific data
  message?: Message;
  toolCallId?: string;
  toolName?: string;
  args?: any;
  result?: any;
  error?: string;
  duration?: number;
  assistantMessageEvent?: any;
  
  // Memory event data
  query?: string;
  sessionsFound?: number;
  contextLength?: number;
  sessionId?: string;
  wouldSave?: boolean;
  saved?: boolean;
  messageCount?: number;
  toolCount?: number;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  args: any;
  result?: any;
  error?: string;
  duration: number;
  success: boolean;
}

export interface AgentResult {
  response: string;
  toolExecutions: ToolExecutionResult[];
  messages: Message[];
  turns: number;
  duration: number;
}

export interface AgentStreamOptions {
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}