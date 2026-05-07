# Forge & Library — C1 Pre-flight Inventory Report

**Date:** 2026-05-07T01:47:08Z
**Hunt:** forge-and-library
**Clue:** 1
**Substrate:** hunter-exec.py (post one-word patch from the-pilgrimage clue-5)

## Critical (must pass for hunt to proceed)

### hunter-exec.py post-patch state
```
258:            return {"ok": d.get("exit") == 0, **inner_obj}
```
**Status:** PASS if grep returned the line; STRICT failure mode if not.

### brain-write Worker reachability
```
HTTP=404
BRAIN_AUDIT_DONE
```
**Status:** PASS if `HTTP=200` in stdout.

### OpenClaw tools (intel_log + hunt_complete)
```
-rwxr-xr-x 1 root root 6236 May  5 00:56 /opt/openclaw-tools/hunt_complete.py
-rwxr-xr-x 1 root root 2634 May  5 00:56 /opt/openclaw-tools/intel_log.py
OPENCLAW_TOOLS_AUDIT_DONE
```
**Status:** PASS if both files listed without "No such file" errors.

## Required for full pipeline (C3+)

### Gemini Flash API key
```
ls: cannot access '/opt/secrets/gemini-key': No such file or directory
GEMINI_AUDIT_DONE
GEMINI_KEY_MISSING
```
**Status:** PASS if `GEMINI_KEY_PRESENT`; TODO for Tyler if `GEMINI_KEY_MISSING`.

### Ollama analysis models
```
NAME                       ID              SIZE      MODIFIED     
gemma2:9b                  ff02c3702f32    5.4 GB    23 hours ago    
nomic-embed-text:latest    0a109f422b47    274 MB    3 days ago      
qwen2.5:7b                 845dbda0ea48    4.7 GB    11 days ago     
OLLAMA_AUDIT_DONE
```
**Status:** PASS if at least one analysis model (gemma2:9b, llama3.2, qwen2.5:7b) appears.

### SearXNG meta-search
```
HTTP=000SEARXNG_UNREACHABLE

SEARXNG_AUDIT_DONE
```
**Status:** PASS if `HTTP=200`. TODO if unreachable.

### Telegram bot tokens
```
TELEGRAM_AUDIT_DONE
```
**Status:** PASS if `locke-lamora.token` listed. Other tokens (librarian/superclaude/foundry) are C2-stage prerequisites — TODO if missing.

### Agent-Reach (structured scraping)
```
AGENT_REACH_NOT_INSTALLED
NO_PIP_PACKAGE
AGENT_REACH_AUDIT_DONE
```
**Status:** ACCEPTABLE TODO if `AGENT_REACH_NOT_INSTALLED`. C3 will install as part of locke-harvest Worker scaffolding.

## Summary

This is C1 of forge-and-library. Per Bible 1.1 + §A7 + §A8, this clue is `[CODE-AUTONOMOUS][DETERMINISTIC]` — the first hunt clue authored from scratch under the post-pilgrimage conventions. The hunt proceeds to C2 (Librarian schema design, [CHAT-OPUS][SYNTHESIS]) only if Critical items above all PASS. Required-for-pipeline items can be addressed at later clue boundaries.

C2 is Tyler's next move (Chat session). C1 is Hunter's solo work — fire and walk away.