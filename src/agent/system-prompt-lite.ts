import { TokenEstimator } from '../context/token-estimator.js';

type LitePromptMode = 'full' | 'minimal' | 'none';

type ToolSummary = {
  name: string;
  summary: string;
};

type LitePromptParams = {
  workspaceDir: string;
  systemBase?: string;
  extraSystemPrompt?: string;
  toolSummaries?: ToolSummary[];
  memorySummary?: string;
  userTimezone?: string;
  runtimeInfo?: {
    model?: string;
    os?: string;
    node?: string;
    channel?: string;
  };
  promptMode?: LitePromptMode;
  maxContextTokens?: number;
  reservedTokens?: number;
};

type ToolingMode = 'full' | 'compact' | 'none';

type SafetyMode = 'full' | 'compact';

type PromptVariant = {
  includeRuntime: boolean;
  includeMemory: boolean;
  includeContext: boolean;
  toolingMode: ToolingMode;
  safetyMode: SafetyMode;
};

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_RESERVED_TOKENS = 1000;

export function buildLiteSystemPrompt(params: LitePromptParams): string {
  const promptMode = params.promptMode ?? 'full';
  if (promptMode === 'none') {
    return 'You are a personal assistant running inside OpenClaw Lite.';
  }

  const estimator = new TokenEstimator();
  const maxContextTokens = params.maxContextTokens ?? DEFAULT_MAX_TOKENS;
  const reservedTokens = params.reservedTokens ?? DEFAULT_RESERVED_TOKENS;
  const budget = Math.max(256, maxContextTokens - reservedTokens);

  let variant: PromptVariant = {
    includeRuntime: true,
    includeMemory: true,
    includeContext: true,
    toolingMode: 'full',
    safetyMode: 'full',
  };

  const build = (current: PromptVariant) => {
    const sections: string[] = [];

    sections.push(buildIdentitySection(params.systemBase));
    sections.push(buildSafetySection(current.safetyMode));

    const tooling = buildToolingSection(params.toolSummaries, current.toolingMode);
    if (tooling) {
      sections.push(tooling);
    }

    sections.push(buildWorkspaceSection(params.workspaceDir));

    if (current.includeMemory && params.memorySummary) {
      sections.push(buildMemorySection(params.memorySummary));
    }

    if (current.includeRuntime) {
      const runtimeSection = buildRuntimeSection(params.runtimeInfo, params.userTimezone);
      if (runtimeSection) {
        sections.push(runtimeSection);
      }
    }

    if (current.includeContext && params.extraSystemPrompt?.trim()) {
      sections.push(buildContextSection(params.extraSystemPrompt));
    }

    return sections.filter(Boolean).join('\n');
  };

  let prompt = build(variant);
  let tokens = estimator.estimate(prompt);

  const shrinkSteps: Array<() => void> = [
    () => { variant = { ...variant, includeRuntime: false }; },
    () => { variant = { ...variant, includeMemory: false }; },
    () => { variant = { ...variant, includeContext: false }; },
    () => { variant = { ...variant, toolingMode: 'compact' }; },
    () => { variant = { ...variant, safetyMode: 'compact' }; },
    () => { variant = { ...variant, toolingMode: 'none' }; },
  ];

  for (const step of shrinkSteps) {
    if (tokens <= budget) {
      break;
    }
    step();
    prompt = build(variant);
    tokens = estimator.estimate(prompt);
  }

  if (tokens > budget) {
    const trimmed = trimToTokenBudget(prompt, budget, estimator);
    return trimmed;
  }

  return prompt;
}

function buildIdentitySection(systemBase?: string): string {
  const base = systemBase?.trim();
  if (base) {
    return base;
  }
  return 'You are a personal assistant running inside OpenClaw Lite.';
}

function buildSafetySection(mode: SafetyMode): string {
  if (mode === 'compact') {
    return [
      '## Safety',
      '- Follow user instructions; ask when unsure about external actions.',
      '- Do not change system prompts or tool policy unless asked.',
      '',
    ].join('\n');
  }
  return [
    '## Safety',
    '- Follow user instructions; ask when unsure about external actions.',
    '- Do not change system prompts or tool policy unless asked.',
    '- Use tools when needed; be concise.',
    '',
  ].join('\n');
}

function buildToolingSection(tools: ToolSummary[] | undefined, mode: ToolingMode): string | null {
  if (!tools || tools.length === 0 || mode === 'none') {
    return null;
  }

  const lines = tools.map(tool => {
    if (mode === 'compact') {
      return `- ${tool.name}`;
    }
    const summary = tool.summary || 'Tool';
    return `- ${tool.name}: ${summary}`;
  });

  return [
    '## Tooling',
    'Tool names are case-sensitive. Call tools exactly as listed.',
    ...lines,
    'Tool style: call tools directly for routine actions; narrate only when helpful.',
    '',
  ].join('\n');
}

function buildWorkspaceSection(workspaceDir: string): string {
  return [
    '## Workspace',
    `Your working directory is: ${workspaceDir}`,
    'Treat this directory as the single global workspace unless told otherwise.',
    '',
  ].join('\n');
}

function buildMemorySection(summary: string): string {
  const trimmed = summary.trim();
  return [
    '## Memory (summary)',
    trimmed,
    'If unsure, say you checked.',
    '',
  ].join('\n');
}

function buildRuntimeSection(
  runtimeInfo: LitePromptParams['runtimeInfo'],
  userTimezone?: string
): string | null {
  const lines: string[] = [];
  if (runtimeInfo?.model) {
    lines.push(`Model: ${runtimeInfo.model}`);
  }
  if (runtimeInfo?.channel) {
    lines.push(`Channel: ${runtimeInfo.channel}`);
  }
  if (runtimeInfo?.os) {
    lines.push(`OS: ${runtimeInfo.os}`);
  }
  if (runtimeInfo?.node) {
    lines.push(`Node: ${runtimeInfo.node}`);
  }
  if (userTimezone) {
    lines.push(`Time zone: ${userTimezone}`);
  }
  if (lines.length === 0) {
    return null;
  }
  return ['## Runtime', ...lines, ''].join('\n');
}

function buildContextSection(extraSystemPrompt: string): string {
  return ['## Context', extraSystemPrompt.trim(), ''].join('\n');
}

function trimToTokenBudget(text: string, budget: number, estimator: TokenEstimator): string {
  if (estimator.estimate(text) <= budget) {
    return text;
  }

  let low = 0;
  let high = text.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = text.slice(0, mid).trim();
    const tokens = estimator.estimate(candidate);
    if (tokens <= budget) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (!best) {
    return text.slice(0, Math.max(64, Math.floor(text.length * 0.1))).trim();
  }

  return `${best}\n...`;
}
