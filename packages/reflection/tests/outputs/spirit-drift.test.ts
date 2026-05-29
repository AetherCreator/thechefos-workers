import { describe, it, expect, vi, afterEach } from "vitest";
import { computeDriftDelta, applySpiritDrift } from "../../src/outputs/spirit-drift";
import type { ComputedMetrics } from "../../src/digest/schema";

const acc = (clean: boolean, total = 5) => ({
  total,
  by_verdict: {},
  by_action: {},
  flagged_drift: clean ? [] : ["OPS-X-DRIFT"],
  notable: [],
});
const churn = (healthy: boolean) => ({
  total_commits_touching_board: 10,
  movements: { urgent_add: healthy ? 1 : 5, backlog_add: 0, claim: 0, complete: healthy ? 5 : 1, revert: 0, remove: 0 },
  velocity: { completes_per_day: 1, urgent_aging: 0 },
  notable: [],
});
const base = (a: boolean, o: boolean): ComputedMetrics => ({
  auto_action_accuracy: acc(a),
  ops_board_churn: churn(o),
  carpenter_stats: { section: "carpenter", error: "n/a" },
  h3_dryrun_signal: { section: "h3", error: "n/a" },
  cost_trajectory: { section: "cost", error: "n/a" },
});

describe("computeDriftDelta", () => {
  it("UP: clean acc + healthy ops -> +1", () => {
    expect(computeDriftDelta(base(true, true)).delta).toBe(1);
  });
  it("DOWN: drift acc + strained ops -> -1", () => {
    expect(computeDriftDelta(base(false, false)).delta).toBe(-1);
  });
  it("HOLD: clean acc + strained ops cancels -> 0", () => {
    expect(computeDriftDelta(base(true, false)).delta).toBe(0);
  });
  it("HOLD: both sections errored -> 0", () => {
    const m: ComputedMetrics = {
      auto_action_accuracy: { section: "aa", error: "x" },
      ops_board_churn: { section: "oc", error: "x" },
      carpenter_stats: { section: "c", error: "x" },
      h3_dryrun_signal: { section: "h", error: "x" },
      cost_trajectory: { section: "ct", error: "x" },
    };
    expect(computeDriftDelta(m).delta).toBe(0);
  });
});

describe("applySpiritDrift", () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { BRAIN_WRITE_BASE: "https://bw.example", BRAIN_WRITE_API_SECRET: "s" };

  it("delta 0 -> no POST attempted", async () => {
    const r = await applySpiritDrift(env, base(true, false));
    expect(r.attempted).toBe(false);
    expect(r.applied).toBe(false);
  });

  it("CLAMP: at level 10, +1 -> at_bound_noop, no set POST", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/level-read")) return new Response(JSON.stringify({ ok: true, level: 10 }), { status: 200 });
      throw new Error("level-set should NOT be called at bound");
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await applySpiritDrift(env, base(true, true));
    expect(r.delta).toBe(1);
    expect(r.applied).toBe(false);
    expect(r.error).toBe("at_bound_noop");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("APPLY: level 7, +1 -> POSTs level-set with reflection_drift", async () => {
    const calls: any[] = [];
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      calls.push({ url, init });
      if (url.endsWith("/level-read")) return new Response(JSON.stringify({ ok: true, level: 7 }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await applySpiritDrift(env, base(true, true));
    expect(r.applied).toBe(true);
    expect(r.previous_level).toBe(7);
    expect(r.new_level).toBe(8);
    const setCall = calls.find((c) => c.url.endsWith("/level-set"));
    expect(JSON.parse(setCall.init.body)).toEqual({ level: 8, source: "reflection_drift" });
    expect(setCall.init.headers["x-brain-write-secret"]).toBe("s");
  });
});
