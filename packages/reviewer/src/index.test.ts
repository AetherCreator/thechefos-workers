import { describe, it, expect, vi } from 'vitest';
import { callKimi } from './index';

function makeEnv(aiRun: ReturnType<typeof vi.fn>): any {
  return {
    AI: { run: aiRun },
    NIM_MODEL: '@cf/moonshotai/kimi-k2.6',
    PER_GATE_TIMEOUT_MS: '60000',
  };
}

const VALID_GATE3 = JSON.stringify({ mobile_ready: true, issues: [], severity: 'none' });
const VALID_GATE3_RESPONSE = { choices: [{ message: { content: VALID_GATE3 } }] };

describe('callKimi retry-with-backoff', () => {
  it('returns scored result when first attempt throws ai_error then second succeeds', async () => {
    const aiRun = vi.fn()
      .mockRejectedValueOnce(new Error('ai_error: upstream transient'))
      .mockResolvedValueOnce(VALID_GATE3_RESPONSE);

    const result = await callKimi('system prompt', 'user prompt', makeEnv(aiRun), 0);

    expect(result.mobile_ready).toBe(true);
    expect(result.severity).toBe('none');
    expect(aiRun).toHaveBeenCalledTimes(2);
  });

  it('returns result when first attempt returns empty content then second succeeds', async () => {
    const aiRun = vi.fn()
      .mockResolvedValueOnce({})                    // no content → "AI binding empty" → retry
      .mockResolvedValueOnce(VALID_GATE3_RESPONSE);

    const result = await callKimi('system prompt', 'user prompt', makeEnv(aiRun), 0);

    expect(result.mobile_ready).toBe(true);
    expect(aiRun).toHaveBeenCalledTimes(2);
  });

  it('throws after all 3 attempts fail — error surfaces exactly once', async () => {
    const aiRun = vi.fn().mockRejectedValue(new Error('ai_error: persistent failure'));

    await expect(callKimi('system prompt', 'user prompt', makeEnv(aiRun), 0))
      .rejects.toThrow('ai_error: persistent failure');

    expect(aiRun).toHaveBeenCalledTimes(3);
  });
});
