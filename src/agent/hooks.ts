import type { AgentConfig, AgentResult, ToolExecutionResult, ToolDefinition } from './types.js';
import type { Message } from '../context/types.js';

export interface AgentHookContext {
  runId?: string;
  sessionId?: string;
  prompt: string;
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  config: AgentConfig;
}

export interface BeforeAgentStartResult {
  prompt?: string;
  systemPrompt?: string;
  messages?: Message[];
}

export interface BeforeToolCallResult {
  arguments?: any;
}

export type BeforeAgentStartHook = (
  context: AgentHookContext
) => Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void;

export type AfterAgentEndHook = (
  context: AgentHookContext,
  result: AgentResult
) => Promise<void> | void;

export type BeforeToolCallHook = (
  context: AgentHookContext,
  toolCall: { name: string; arguments: any }
) => Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;

export type AfterToolCallHook = (
  context: AgentHookContext,
  execution: ToolExecutionResult
) => Promise<void> | void;

export interface AgentHooks {
  beforeAgentStart?: BeforeAgentStartHook[];
  afterAgentEnd?: AfterAgentEndHook[];
  beforeToolCall?: BeforeToolCallHook[];
  afterToolCall?: AfterToolCallHook[];
}
