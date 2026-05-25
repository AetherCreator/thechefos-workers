import { describe, it, expect, beforeEach } from 'vitest';
import { grantXp, readRole, readAll, seedInitialState } from '../index';
import { computeLevel, xpToNextLevel } from '../helpers';
import { initialState, DEFAULT_THRESHOLDS } from '../schema';

// Mock KV
class MockKV implements KVNamespace {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list() { return { keys: Array.from(this.store.keys()).map((name) => ({ name })) } as any; }
  // ... stub remaining methods as needed
}

const makeEnv = () => ({
  CREW_XP_KV: new MockKV(),
  CREW_XP_DEDUP_KV: new MockKV(),
});

describe('crew-xp schema + helpers', () => {
  it('computes level from xp via thresholds', () => {
    expect(computeLevel(0, DEFAULT_THRESHOLDS)).toBe(1);
    expect(computeLevel(9, DEFAULT_THRESHOLDS)).toBe(1);
    expect(computeLevel(10, DEFAULT_THRESHOLDS)).toBe(2);
    expect(computeLevel(39, DEFAULT_THRESHOLDS)).toBe(2);
    expect(computeLevel(40, DEFAULT_THRESHOLDS)).toBe(3);
    expect(computeLevel(99, DEFAULT_THRESHOLDS)).toBe(3);
    expect(computeLevel(100, DEFAULT_THRESHOLDS)).toBe(4);
    expect(computeLevel(199, DEFAULT_THRESHOLDS)).toBe(4);
    expect(computeLevel(200, DEFAULT_THRESHOLDS)).toBe(5);
    expect(computeLevel(9999, DEFAULT_THRESHOLDS)).toBe(5);
  });

  it('initialState marks librarian as not deployed', () => {
    expect(initialState('librarian').deployed).toBe(false);
    expect(initialState('captain').deployed).toBe(true);
  });
});

describe('crew-xp grant flow', () => {
  it('applies grant on first call, dedupes on replay', async () => {
    const env = makeEnv();
    await seedInitialState(env);
    const r1 = await grantXp(env, { role: 'captain', completion_id: 'comp-1' });
    expect(r1).toMatchObject({ applied: true, role: 'captain', prior_xp: 0, new_xp: 1 });
    const r2 = await grantXp(env, { role: 'captain', completion_id: 'comp-1' });
    expect(r2).toMatchObject({ deduped: true });
  });

  it('skips librarian (undeployed)', async () => {
    const env = makeEnv();
    await seedInitialState(env);
    const r = await grantXp(env, { role: 'librarian', completion_id: 'comp-l1' });
    expect(r).toMatchObject({ skipped: true, reason: 'role_undeployed' });
    const state = await readRole(env, 'librarian');
    expect(state?.total_grants).toBe(0);
  });

  it('promotes level when threshold crossed', async () => {
    const env = makeEnv();
    await seedInitialState(env);
    for (let i = 0; i < 10; i++) {
      await grantXp(env, { role: 'hunter', completion_id: `comp-h-${i}` });
    }
    const state = await readRole(env, 'hunter');
    expect(state?.level).toBe(2);
    expect(state?.xp).toBe(10);
  });

  it('rejects invalid payload', async () => {
    const env = makeEnv();
    await seedInitialState(env);
    await expect(grantXp(env, { role: 'invalid', completion_id: 'x' })).rejects.toThrow(/grant_payload_invalid/);
    await expect(grantXp(env, { role: 'captain' })).rejects.toThrow(/grant_payload_invalid/);
  });

  it('respects xp_delta', async () => {
    const env = makeEnv();
    await seedInitialState(env);
    await grantXp(env, { role: 'mapmaker', completion_id: 'mm-1', xp_delta: 5 });
    const state = await readRole(env, 'mapmaker');
    expect(state?.xp).toBe(5);
  });

  it('readAll returns all 8 roles', async () => {
    const env = makeEnv();
    await seedInitialState(env);
    const all = await readAll(env);
    expect(Object.keys(all)).toHaveLength(8);
    expect(all.captain.deployed).toBe(true);
    expect(all.librarian.deployed).toBe(false);
  });

  it('seedInitialState is idempotent', async () => {
    const env = makeEnv();
    const first = await seedInitialState(env);
    expect(first.created).toHaveLength(8);
    const second = await seedInitialState(env);
    expect(second.existing).toHaveLength(8);
    expect(second.created).toHaveLength(0);
  });

  it('xpToNextLevel returns null at Lv 5', () => {
    const state = initialState('captain');
    expect(xpToNextLevel(state)).toBe(10);
    const maxed = { ...state, level: 5 as const, xp: 200 };
    expect(xpToNextLevel(maxed)).toBeNull();
  });
});
