# OpenClaw Lite

A minimal, focused version of OpenClaw designed for **local LLMs** with enhanced context management and security.

## 🎯 Goals

1. **Reduce context‑window requirements** for 4K–8K local models
2. **Increase security** for identity files (SOUL.md, USER.md)
3. **Add audit trails** for debugging and transparency
4. **Minimal footprint** - remove bloat, keep essentials

## 🚀 Quick Start

```bash
# Clone and build
git clone <repository-url> openclaw-lite
cd openclaw-lite
npm install
npm run build

# Test the system
npm test

# Run CLI (distinct from 'openclaw' command)
node dist/cli/cli.js --help
```

## 📦 Installation

```bash
# Install globally (optional)
cd openclaw-lite
npm link

# Now you can use 'claw-lite' command anywhere
claw-lite --help
```

## 🛠️ CLI Commands

### Context Management
```bash
# Compress a conversation to fit within token limits
claw-lite context --max-tokens 4000 --strategy hybrid

# Load from a JSON file
claw-lite context --file conversation.json --max-tokens 8000
```

### Model Selection
```bash
# Find the best model for a task
claw-lite model --input-tokens 3000 --output-tokens 1000 --needs-tools --priority local

# Cost-optimized selection
claw-lite model --input-tokens 2000 --output-tokens 500 --priority cost

# Quality-focused selection  
claw-lite model --input-tokens 5000 --output-tokens 2000 --priority quality
```

### Token Estimation
```bash
# Estimate tokens in text
claw-lite tokens "Your text here"

# Model-specific estimation
claw-lite tokens "Code example: function test() { return 42; }" --model ollama/qwen2.5-coder:7b
```

### Testing
```bash
# Run comprehensive tests
claw-lite test
```

## 🧠 Core Components

### Context Manager
- **Adaptive compression** for long conversations
- **Multiple strategies**: truncate, selective, hybrid
- **Token‑aware** history management
- **Preserves important messages** (first/last, tool calls)

### Model Router
- **Smart model selection** based on task requirements
- **Cost optimization** - prefers local models
- **Capability matching** - tools, vision, context size
- **Priority‑based ranking** (local, cost, speed, quality)

### Token Estimator
- **Model‑specific** token counting
- **Accurate estimates** for better context management
- **Code‑aware** estimation for programming tasks

## 📁 Project Structure

```
openclaw-lite/
├── src/
│   ├── context/           # Core context management
│   │   ├── types.ts       # Type definitions
│   │   ├── token-estimator.ts
│   │   ├── context-manager.ts
│   │   └── model-router.ts
│   ├── cli/              # Command-line interface
│   │   └── cli.ts        # Main CLI (distinct from 'openclaw')
│   └── index.ts          # Library entry point
├── test/                 # Comprehensive tests
├── dist/                 # Compiled output
└── package.json          # Minimal dependencies
```

## 🔧 Integration Example

```typescript
import { ContextManager, ModelRouter } from 'openclaw-lite';

// Manage conversation context
const manager = new ContextManager({
  maxContextTokens: 8192,
  compressionStrategy: 'hybrid'
});

const compressed = await manager.compressHistory(
  conversationHistory,
  systemPrompt,
  'ollama/qwen3:latest'
);

// Select optimal model
const router = new ModelRouter();
const task = {
  estimatedInputTokens: 3000,
  estimatedOutputTokens: 1000,
  needsTools: true,
  needsVision: false,
  priority: 'local'
};

const model = router.selectModel(task);
console.log(`Using model: ${model.modelId}`); // e.g., "ollama/qwen3:latest"
```

## 🎨 Design Philosophy

### 1. **Do Less, Better**
- Remove unnecessary channels (keep only Telegram)
- Simplify skill system
- Focus on local LLM optimization

### 2. **Context‑First**
- Make 4K–8K context windows usable
- Intelligent history compression
- Model‑aware routing

### 3. **Security by Design**
- File encryption for sensitive data
- Skill sandboxing
- Audit trails for all actions

### 4. **Debuggability**
- Structured action logging
- Execution graphs
- Visual trace visualization

## 📈 Performance Goals

- **Context usage** reduced by 50% for typical conversations
- **Local model usage** increased to 80% of requests  
- **API costs** reduced by 70%
- **Startup time** reduced by 30%
- **Memory footprint** reduced by 40%

## 🚧 Roadmap

### Phase 1 (Current) - Core Context Management ✅
- [x] Context Manager with adaptive compression
- [x] Model Router for smart model selection
- [x] Token Estimator for accurate counting
- [x] Minimal CLI tool (`claw-lite`)

### Phase 2 - Security Layer
- [ ] File encryption for SOUL.md/USER.md
- [ ] Skill permission system
- [ ] Secure workspace isolation

### Phase 3 - Audit System
- [ ] Structured action logging
- [ ] Execution graph generation
- [ ] Trace visualization tools

### Phase 4 - Integration
- [ ] Ollama integration for local inference
- [ ] Telegram channel plugin
- [ ] Skill system compatibility

## 🔒 Security Note

This is a **separate tool** from your main OpenClaw installation. It uses:
- **Different command**: `claw-lite` vs `openclaw`
- **Separate configuration**
- **Isolated workspace**

No risk of accidentally modifying your running OpenClaw environment.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

## 📄 License

MIT - See LICENSE file

---

**Built for local LLMs, by someone who understands the struggle.**