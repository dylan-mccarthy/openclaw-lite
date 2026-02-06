import { describe, it, expect } from 'vitest';
import { TaskPlanner } from '../../src/agent/task-planner.js';

describe('TaskPlanner', () => {
  it('flags complex prompts for planning', () => {
    const planner = new TaskPlanner({ maxContextTokens: 4000, reservedTokens: 500 });
    const decision = planner.shouldPlan('Please break down this refactor into steps', 'system');

    expect(decision.shouldPlan).toBe(true);
    expect(decision.reason).toBe('complexity_keywords');
  });

  it('creates a plan and updates working summary', () => {
    const planner = new TaskPlanner({ maxSteps: 3 });
    const plan = planner.createPlan('Do this:\n- Step one\n- Step two\n- Step three\n- Step four');

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].status).toBe('in_progress');

    const summary = planner.createWorkingSummary(plan);
    const updated = planner.updateWorkingSummary(summary, {
      changes: ['Added file A'],
      decisions: ['Use config X'],
      openQuestions: ['Need approval?'],
      nextStep: 'Step two',
    });

    expect(updated.changes).toContain('Added file A');
    expect(updated.decisions).toContain('Use config X');
    expect(updated.openQuestions).toContain('Need approval?');
    expect(updated.nextStep).toBe('Step two');
  });
});
