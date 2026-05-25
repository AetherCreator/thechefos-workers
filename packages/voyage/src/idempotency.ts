export async function computeIdempotencyKey(
  voyage_id: string,
  role: string,
  output_ref: string
): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${voyage_id}:${role}:${output_ref}`)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
