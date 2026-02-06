import type {
  AgentHooks,
  AfterAgentEndHook,
  AfterToolCallHook,
  BeforeAgentStartHook,
  BeforeToolCallHook,
} from './hooks.js';

export class HookRegistry {
  private hooks: Required<AgentHooks> = {
    beforeAgentStart: [],
    afterAgentEnd: [],
    beforeToolCall: [],
    afterToolCall: [],
  };

  getHooks(): Required<AgentHooks> {
    return this.hooks;
  }

  registerBeforeAgentStart(hook: BeforeAgentStartHook): void {
    this.hooks.beforeAgentStart.push(hook);
  }

  registerAfterAgentEnd(hook: AfterAgentEndHook): void {
    this.hooks.afterAgentEnd.push(hook);
  }

  registerBeforeToolCall(hook: BeforeToolCallHook): void {
    this.hooks.beforeToolCall.push(hook);
  }

  registerAfterToolCall(hook: AfterToolCallHook): void {
    this.hooks.afterToolCall.push(hook);
  }
}
