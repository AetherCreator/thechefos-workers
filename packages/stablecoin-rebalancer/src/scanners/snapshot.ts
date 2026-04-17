import type { Env } from "../lib/assert-read-only";
import { assertReadOnly } from "../lib/assert-read-only";
import { writeSnapshotBatch, logScannerRun } from "../lib/db";
import { fetchAaveRates } from "../lib/aave-client";
import { fetchCompoundRates } from "../lib/compound-client";
import { fetchYearnRates } from "../lib/yearn-client";

export async function runRateSnapshot(env: Env): Promise<{ batchId: string; rowsWritten: number }> {
  const start = Date.now();
  assertReadOnly(env);
  const batchId = `snap-${start}`;

  let status: "ok" | "error" | "partial" = "ok";
  let rowsWritten = 0;
  let errorMsg: string | undefined;

  try {
    const [aaveResult, compResult, yearnResult] = await Promise.allSettled([
      fetchAaveRates(env),
      fetchCompoundRates(env),
      fetchYearnRates(),
    ]);
    const rows = [] as Awaited<ReturnType<typeof fetchAaveRates>>;
    let partial = false;
    if (aaveResult.status === "fulfilled") rows.push(...aaveResult.value);
    else { partial = true; errorMsg = `aave: ${aaveResult.reason}`; }
    if (compResult.status === "fulfilled") rows.push(...compResult.value);
    else { partial = true; errorMsg = (errorMsg ?? "") + ` | compound: ${compResult.reason}`; }
    if (yearnResult.status === "fulfilled") rows.push(...yearnResult.value);
    else { partial = true; errorMsg = (errorMsg ?? "") + ` | yearn: ${yearnResult.reason}`; }

    if (rows.length === 0) {
      status = "error";
      errorMsg = errorMsg ?? "all rate sources failed";
    } else {
      if (partial) status = "partial";
      rowsWritten = await writeSnapshotBatch(env, batchId, rows);
    }
  } catch (e: unknown) {
    status = "error";
    errorMsg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.error("snapshot scanner:", errorMsg);
  } finally {
    await logScannerRun(env, {
      scanner: "snapshot",
      started_ts: start,
      duration_ms: Date.now() - start,
      status,
      rows_written: rowsWritten,
      error_msg: errorMsg ?? null,
    });
  }

  return { batchId, rowsWritten };
}
