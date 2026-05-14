Commit SHA: 9704170
Line-number+file pairs:
packages/locke-harvest/src/index.ts:205
packages/locke-harvest/src/index.ts:546
Grep self-verify output:
grep -c 'async function callLLM' packages/locke-harvest/src/index.ts -> 1
grep -c 'async function callNim' packages/locke-harvest/src/index.ts -> 0
grep -c 'await callLLM(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts -> 1
grep -c 'await callNim(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts -> 0
/health probe: {"ok":true,"persona":"lookout","schema":"locke-1.2","model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast","search_adapters":"reddit+hn+brave (hybrid v2)"}