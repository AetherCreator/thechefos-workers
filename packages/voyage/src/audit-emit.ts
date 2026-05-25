// SubDiv: /api/auto-actions/write route does not yet exist on brain-write (confirmed via substrate
// preflight). When BRAIN_WRITE_BASE_URL is unset, emitAudit returns a no-op stub so the route
// can function in dev/test without the endpoint. C5 will wire the real endpoint and remove the stub.

export type AuditEmitResult = { ok: true; audit_id: string } | { ok: false; error: string };

export async function emitAudit(
  env: { BRAIN_WRITE_BASE_URL?: string; BRAIN_WRITE_API_SECRET?: string },
  action: 'voyage_state_advance' | 'voyage_abort',
  target: string,
  payload: object
): Promise<AuditEmitResult> {
  if (!env.BRAIN_WRITE_BASE_URL) {
    return { ok: true, audit_id: `stub-${Date.now()}` };
  }

  try {
    const r = await fetch(`${env.BRAIN_WRITE_BASE_URL}/api/auto-actions/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Brain-Write-Secret': env.BRAIN_WRITE_API_SECRET ?? '',
      },
      body: JSON.stringify({ action, target, payload, ts: new Date().toISOString() }),
    });

    if (!r.ok) {
      return { ok: false, error: `brain-write returned ${r.status}` };
    }

    const body = await r.json() as { audit_id?: string };
    return { ok: true, audit_id: body.audit_id ?? 'unknown' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
