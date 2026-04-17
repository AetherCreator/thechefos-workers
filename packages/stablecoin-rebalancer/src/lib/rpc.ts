/** Shared eth_call helper used by aave-client, compound-client. */
export async function ethCall(rpcUrl: string, to: string, dataHex: string): Promise<string> {
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to, data: dataHex }, "latest"],
    }),
  });
  if (!r.ok) throw new Error(`eth_call ${r.status}`);
  const data = await r.json() as { result?: string; error?: { message: string } };
  if (data.error) throw new Error(`eth_call error: ${data.error.message}`);
  return data.result ?? "0x";
}
