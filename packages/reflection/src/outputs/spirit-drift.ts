import type { ComputedMetrics, AutoActionAccuracy, OpsBoardChurn } from "../digest/schema";
import { isSectionError } from "../digest/schema";

// Pb — System Spirit Level weekly drift (P3 Reflection write authority).
// v1 uses two boolean signals: auto-action drift-freeness + OPS-BOARD churn health.
// Council quorum input is unavailable (verdict payload shape unaudited per digest/placeholders §6)
// so it contributes 0 (documented soft-degrade). Net sign collapses to {-1,0,+1}, which structurally
// enforces the ±1/week bound from the OPS-ONETEN-P5-PB spec. Finer weighting / KV-config = follow-on.

export interface SpiritDriftEnv {
  BRAIN_WRITE_BASE: string;
  BRAIN_WRITE_API_SECRET: string;
}

export interface SpiritDriftResult {
  attempted: boolean;
  delta: -1 | 0 | 1;
  reason: string;
  previous_level?: number;
  new_level?: number;
  applied: boolean;
  error?: string;
}

export function computeDriftDelta(computed: ComputedMetrics): { delta: -1 | 0 | 1; reason: string } {
  let acc = 0;
  let accReason = "acc:n/a";
  if (!isSectionError(computed.auto_action_accuracy)) {
    const aa = computed.auto_action_accuracy as AutoActionAccuracy;
    if (aa.total > 0 && aa.flagged_drift.length === 0) {
      acc = 1;
      accReason = "acc:clean";
    } else if (aa.flagged_drift.length > 0) {
      acc = -1;
      accReason = `acc:drift(${aa.flagged_drift.length})`;
    } else {
      accReason = "acc:hold";
    }
  }

  let ops = 0;
  let opsReason = "ops:n/a";
  if (!isSectionError(computed.ops_board_churn)) {
    const m = (computed.ops_board_churn as OpsBoardChurn).movements;
    if (m.complete > m.urgent_add && m.revert === 0) {
      ops = 1;
      opsReason = `ops:healthy(c${m.complete}>u${m.urgent_add})`;
    } else if (m.urgent_add > m.complete || m.revert > 0) {
      ops = -1;
      opsReason = `ops:strained(u${m.urgent_add}/c${m.complete}/r${m.revert})`;
    } else {
      opsReason = "ops:hold";
    }
  }

  const net = acc + ops;
  const delta: -1 | 0 | 1 = net > 0 ? 1 : net < 0 ? -1 : 0;
  return { delta, reason: `${accReason} ${opsReason} council:n/a -> net=${net} delta=${delta}` };
}

export async function applySpiritDrift(
  env: SpiritDriftEnv,
  computed: ComputedMetrics
): Promise<SpiritDriftResult> {
  const { delta, reason } = computeDriftDelta(computed);
  if (delta === 0) {
    return { attempted: false, delta, reason, applied: false };
  }
  try {
    const readResp = await fetch(`${env.BRAIN_WRITE_BASE}/api/spirit/level-read`);
    if (!readResp.ok) {
      return { attempted: true, delta, reason, applied: false, error: `level-read ${readResp.status}` };
    }
    const cur = (await readResp.json()) as { ok: boolean; level: number };
    const prev = cur.level;
    const next = Math.max(0, Math.min(10, prev + delta));
    if (next === prev) {
      return { attempted: true, delta, reason, applied: false, previous_level: prev, new_level: next, error: "at_bound_noop" };
    }
    const setResp = await fetch(`${env.BRAIN_WRITE_BASE}/api/spirit/level-set`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-brain-write-secret": env.BRAIN_WRITE_API_SECRET },
      body: JSON.stringify({ level: next, source: "reflection_drift" }),
    });
    if (!setResp.ok) {
      const t = await setResp.text();
      return { attempted: true, delta, reason, applied: false, previous_level: prev, error: `level-set ${setResp.status}: ${t.slice(0, 120)}` };
    }
    return { attempted: true, delta, reason, applied: true, previous_level: prev, new_level: next };
  } catch (e) {
    return { attempted: true, delta, reason, applied: false, error: String(e) };
  }
}
