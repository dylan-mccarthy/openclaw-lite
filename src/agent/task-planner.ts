import { TokenEstimator } from '../context/token-estimator.js';
import type { TaskPlan, TaskPlanStep, WorkingSummary } from './types.js';

type PlanDecision = {
  shouldPlan: boolean;
  reason: string;
  promptTokens: number;
  systemTokens: number;
  totalTokens: number;
  budgetTokens: number;
};

type PlannerOptions = {
  maxContextTokens?: number;
  reservedTokens?: number;
  maxSteps?: number;
};

type SummaryPatch = {
  changes?: string[];
  decisions?: string[];
  openQuestions?: string[];
  nextStep?: string;
};

const DEFAULT_MAX_CONTEXT_TOKENS = 8192;
const DEFAULT_RESERVED_TOKENS = 1000;
const DEFAULT_MAX_STEPS = 6;

export class TaskPlanner {
  private estimator: TokenEstimator;
  private options: Required<PlannerOptions>;

  constructor(options: PlannerOptions = {}) {
    this.estimator = new TokenEstimator();
    this.options = {
      maxContextTokens: options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
      reservedTokens: options.reservedTokens ?? DEFAULT_RESERVED_TOKENS,
      maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    };
  }

  shouldPlan(prompt: string, systemPrompt: string): PlanDecision {
    const promptTokens = this.estimator.estimate(prompt);
    const systemTokens = this.estimator.estimate(systemPrompt);
    const totalTokens = promptTokens + systemTokens;
    const budgetTokens = Math.max(0, this.options.maxContextTokens - this.options.reservedTokens);

    const lengthTrigger = totalTokens > Math.floor(budgetTokens * 0.55);
    const complexityTrigger = /\b(multi|multiple|several|steps?|plan|break down|roadmap|refactor|migrate|sweep)\b/i.test(prompt);

    const shouldPlan = lengthTrigger || complexityTrigger;
    const reason = lengthTrigger
      ? 'prompt_length'
      : complexityTrigger
        ? 'complexity_keywords'
        : 'not_needed';

    return {
      shouldPlan,
      reason,
      promptTokens,
      systemTokens,
      totalTokens,
      budgetTokens,
    };
  }

  createPlan(prompt: string): TaskPlan {
    const steps = this.extractSteps(prompt);
    const createdAt = Date.now();

    return {
      id: `plan_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      summary: steps.map(step => step.title).join(' | '),
      steps,
    };
  }

  createWorkingSummary(plan?: TaskPlan): WorkingSummary {
    return {
      updatedAt: Date.now(),
      changes: [],
      decisions: [],
      openQuestions: [],
      nextStep: plan?.steps.find(step => step.status === 'pending')?.title,
    };
  }

  updateWorkingSummary(summary: WorkingSummary, patch: SummaryPatch): WorkingSummary {
    const updated: WorkingSummary = {
      ...summary,
      updatedAt: Date.now(),
      changes: mergeUnique(summary.changes, patch.changes),
      decisions: mergeUnique(summary.decisions, patch.decisions),
      openQuestions: mergeUnique(summary.openQuestions, patch.openQuestions),
      nextStep: patch.nextStep ?? summary.nextStep,
    };

    updated.changes = trimList(updated.changes, 10);
    updated.decisions = trimList(updated.decisions, 10);
    updated.openQuestions = trimList(updated.openQuestions, 10);

    return updated;
  }

  private extractSteps(prompt: string): TaskPlanStep[] {
    const lines = prompt.split(/\r?\n/).map(line => line.trim());
    const stepCandidates: string[] = [];

    for (const line of lines) {
      const match = line.match(/^([-*]|\d+\.)\s+(.*)/);
      if (match && match[2]) {
        stepCandidates.push(match[2].trim());
      }
    }

    if (stepCandidates.length === 0) {
      stepCandidates.push(
        'Understand the request and scope',
        'Identify relevant files and constraints',
        'Make the required changes',
        'Validate results and summarize'
      );
    }

    return stepCandidates
      .slice(0, this.options.maxSteps)
      .map((title, index) => ({
        id: `step_${index + 1}`,
        title: normalizeStepTitle(title),
        status: index === 0 ? 'in_progress' : 'pending',
      }));
  }
}

function normalizeStepTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function mergeUnique(current: string[], next?: string[]): string[] {
  if (!next || next.length === 0) {
    return current.slice();
  }
  const seen = new Set(current.map(item => item.toLowerCase()));
  const merged = current.slice();
  for (const item of next) {
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(normalized);
    }
  }
  return merged;
}

function trimList(items: string[], maxItems: number): string[] {
  if (items.length <= maxItems) {
    return items;
  }
  return items.slice(items.length - maxItems);
}
