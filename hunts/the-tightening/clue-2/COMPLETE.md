Commit SHA: a5204fc
Edits:
- packages/locke-harvest/src/index.ts:205: async function callNim -> async function callLLM
- packages/locke-harvest/src/index.ts:546: await callNim(SYSTEM_PROMPT -> await callLLM(SYSTEM_PROMPT
grep self-verify:
- grep -c 'async function callLLM' packages/locke-harvest/src/index.ts = 1
- grep -c 'async function callNim' packages/locke-harvest/src/index.ts = 0
- grep -c 'await callLLM(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts = 1
- grep -c 'await callNim(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts = 0
/health probe: ok: true