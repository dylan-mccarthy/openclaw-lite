# Core Agent Loop Implementation Plan (3 Phases)

## Current Status
✅ **Tool system complete** - 18 tools, OpenAI-compatible API  
✅ **Ada persona working** - 2015 chars, preserves personality  
✅ **Web API working** - `/api/chat-with-tools` endpoint  
❌ **No agent loop** - Single message → response only  

## OpenClaw Architecture Analysis

### Key Components:
1. **`agentLoop()`** - Entry point for new prompts  
2. **`agentLoopContinue()`** - Continue from existing context  
3. **`runLoop()`** - Main loop with tool execution  
4. **`EventStream`** - Async event handling  
5. **Tool execution** - Sequential, results integrated  

### Core Flow:
```
User Message → Agent Loop → LLM → Tool Calls → Results → LLM → Final Response
                    ↑                                      ↓
               Queued Messages ←─────── Steering/Interruptions
```

---

## Phase 1: Foundation Agent Loop (Today)
**Goal**: Working agent that can execute multiple tools in sequence

### Deliverables:
1. **✅ AgentLoop class** (`src/agent/agent-loop.ts`)  
   - Basic event streaming  
   - Tool execution integration  
   - Conversation state management  

2. **✅ Agent types** (`src/agent/types.ts`)  
   - Context, events, results interfaces  

3. **✅ EventStream** (`src/agent/event-stream.ts`)  
   - Async event handling  

4. **Tool execution bridge**  
   - Connect AgentLoop to existing ToolManager  
   - Handle tool results and errors  

5. **Integration layer**  
   - Update `OpenClawToolIntegration` to use AgentLoop  
   - Keep backward compatibility  

6. **Basic web API**  
   - New endpoint `/api/agent/run`  
   - Returns final result (non-streaming initially)  

### Success Criteria:
- ✅ Agent executes 2+ tool calls in sequence (e.g., `list` → `git_status`)  
- ✅ Tool results integrated into conversation  
- ✅ Works with Ada persona  
- ✅ Backward compatible (existing `/api/chat-with-tools` still works)  

---

## Phase 2: Streaming & Advanced Features (Tomorrow)
**Goal**: Real-time streaming and OpenClaw-style features

### Deliverables:
1. **Streaming web API**  
   - Server-Sent Events (SSE) endpoint `/api/agent/stream`  
   - Real-time tool execution updates  
   - Live assistant response streaming  

2. **Steering/interruptions**  
   - Basic queued message system  
   - Ability to send follow-up messages during execution  

3. **Memory integration**  
   - Memory search before responses  
   - Context compression for long conversations  

4. **Enhanced error handling**  
   - Tool execution failures don't crash agent  
   - LLM API error recovery  
   - Timeout handling  

### Success Criteria:
- ✅ Web UI shows real-time tool execution  
- ✅ Can interrupt agent with new messages  
- ✅ Memory recall works for file/project questions  
- ✅ Robust error handling in production scenarios  

---

## Phase 3: Production & Extensibility (Day 3)
**Goal**: Production-ready system with extensibility

### Deliverables:
1. **Performance optimizations**  
   - Context window management  
   - Tool result summarization  
   - Response caching  

2. **Monitoring & analytics**  
   - Tool usage tracking  
   - Response time metrics  
   - Error rate monitoring  

3. **Skill system integration**  
   - Skill detection and execution  
   - Skill-specific tool access  

4. **Sub-agent system**  
   - Spawn sub-agents for parallel tasks  
   - Result aggregation  
   - Parent-child coordination  

5. **Configuration system**  
   - Agent configuration UI  
   - Model switching during execution  
   - Tool enable/disable per agent  

### Success Criteria:
- ✅ Handles 10+ tool calls without performance issues  
- ✅ Monitoring dashboard shows agent metrics  
- ✅ Skills can be invoked automatically  
- ✅ Sub-agents work for parallel research tasks  

---

## Technical Implementation Details

### Phase 1 Architecture:
```typescript
// Core flow
User → Web API → AgentLoop → OpenAI Client → Tool Execution → Results → Final Response
                                         ↑                        ↓
                                   Tool Definitions ←─── ToolManager
```

### Key Interfaces:
```typescript
interface AgentLoop {
  run(prompt, systemPrompt, tools): Promise<AgentResult>
}

interface AgentResult {
  response: string
  toolExecutions: ToolExecution[]
  messages: Message[]
  turns: number
  duration: number
}
```

### Integration Points:
1. **ToolManager** → Provides tool definitions and execution  
2. **OpenClawOpenAIClient** → Handles OpenAI API calls  
3. **WebServer** → Exposes agent endpoints  
4. **ModelTemplateRegistry** → Handles model-specific formatting  

---

## Risks & Mitigations

### Risk 1: Complexity Overload
**Mitigation**: Phase 1 is minimal viable loop. No streaming, no memory, just sequential tool execution.

### Risk 2: Performance Issues
**Mitigation**: Implement timeouts. Use existing OpenAI client with 120s timeout.

### Risk 3: Integration Breakage
**Mitigation**: Keep `/api/chat-with-tools` working. New endpoint `/api/agent/run` for agent loop.

### Risk 4: Tool Execution Errors
**Mitigation**: Wrap tool calls in try/catch. Continue with error messages in context.

---

## Timeline & Milestones

### Phase 1 (Today - Foundation):
- **Morning**: Complete AgentLoop + Tool integration  
- **Afternoon**: Integrate with WebServer + testing  
- **Evening**: Bug fixes + documentation  

### Phase 2 (Tomorrow - Streaming):
- **Morning**: SSE streaming implementation  
- **Afternoon**: Steering/memory features  
- **Evening**: Web UI updates + testing  

### Phase 3 (Day 3 - Production):
- **Morning**: Performance optimizations  
- **Afternoon**: Monitoring + skill system  
- **Evening**: Final testing + polish  

---

## Starting Now: Phase 1 Implementation

**Current progress**: ✅ Types, ✅ EventStream, ✅ AgentLoop stub  
**Next step**: Wire AgentLoop to ToolManager for actual tool execution