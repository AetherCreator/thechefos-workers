import { describe, it, expect, vi } from 'vitest';
import { callJudge } from './index';

function makeEnv(aiRun: ReturnType<typeof vi.fn>): any {
  return {
    AI: { run: aiRun },
    NIM_MODEL: '@cf/moonshotai/kimi-k2.6',
    PER_JUDGE_TIMEOUT_MS: '60000',
  };
}

const VALID_REALIST = JSON.stringify({
  judge: 'realist',
  score: 75,
  verdict: 'Feasible for a solo dev in a weekend.',
  red_flags: [],
  green_flags: ['Simple UI'],
  build_estimate: '8',
});
const VALID_RESPONSE = { choices: [{ message: { content: VALID_REALIST } }] };

describe('callJudge retry-with-backoff', () => {
  it('returns scored result (NOT abstain) when first attempt throws ai_error then second succeeds', async () => {
    const aiRun = vi.fn()
      .mockRejectedValueOnce(new Error('ai_error: upstream transient'))
      .mockResolvedValueOnce(VALID_RESPONSE);

    const result = await callJudge('realist', 'system', 'user', makeEnv(aiRun), 0);

    expect(result.abstain).toBeUndefined();
    expect(result.score).toBe(75);
    expect(result.judge).toBe('realist');
    expect(aiRun).toHaveBeenCalledTimes(2);
  });

  it('returns scored result when first attempt returns empty content then second succeeds', async () => {
    const aiRun = vi.fn()
      .mockResolvedValueOnce({})              // no content → "AI binding empty" → retry
      .mockResolvedValueOnce(VALID_RESPONSE);

    const result = await callJudge('realist', 'system', 'user', makeEnv(aiRun), 0);

    expect(result.abstain).toBeUndefined();
    expect(result.score).toBe(75);
    expect(aiRun).toHaveBeenCalledTimes(2);
  });

  it('returns abstain exactly once after all 3 attempts fail', async () => {
    const aiRun = vi.fn().mockRejectedValue(new Error('ai_error: persistent failure'));

    const result = await callJudge('realist', 'system', 'user', makeEnv(aiRun), 0);

    expect(result.abstain).toBe(true);
    expect(result.judge).toBe('realist');
    expect(result.reason).toMatch(/ai_error/);
    expect(aiRun).toHaveBeenCalledTimes(3);
  });
});
