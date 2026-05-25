import type { Env } from '../../types';
import { SEVERITY_SYSTEM_PROMPT, buildSeverityUserPrompt } from './judge-prompt';
import { isUnderCap } from './costCap';
import type { SeverityLevel } from '../../changelogSchema';

export interface JudgeResult {
  severity: SeverityLevel;
  confidence: number;
  signals: { signal: string; evidence: string }[];
}

const VALID_SEVERITY = new Set<string>(['security_advisory', 'breaking_change', 'deprecation', 'minor']);

// Mirror of Council's extractJsonObject — strips <think> blocks, fences, then finds JSON boundaries.
function extractJsonObject(text: string): any {
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const noFence = noThink.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const start = noFence.indexOf('{');
  const end = noFence.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(noFence.slice(start, end + 1));
}

function parseSafeJudgeResult(parsed: any): JudgeResult {
  const severity = VALID_SEVERITY.has(parsed?.severity) ? (parsed.severity as SeverityLevel) : 'minor';
  const confidence =
    typeof parsed?.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.0;
  const signals = Array.isArray(parsed?.signals)
    ? parsed.signals.map((s: any) => ({
        signal: String(s?.signal ?? 'unknown').slice(0, 100),
        evidence: String(s?.evidence ?? '').slice(0, 300)
      }))
    : [];
  return { severity, confidence, signals };
}

export async function judgeSeverity(
  env: Env,
  depName: string,
  releaseTitle: string,
  releaseUrl: string,
  releaseBody: string
): Promise<JudgeResult> {
  const underCap = await isUnderCap(env);
  if (!underCap) {
    return {
      severity: 'minor',
      confidence: 0.0,
      signals: [{ signal: 'cost_cap_exceeded', evidence: 'monthly budget exceeded; conservative minor assigned' }]
    };
  }

  const userPrompt = buildSeverityUserPrompt(depName, releaseTitle, releaseUrl, releaseBody);

  try {
    // Mirror Council's callJudge: env.AI.run() binding, OpenAI-compat response shape.
    // Auth: env.AI Workers AI binding — same credential surface as Council (no extra secrets needed).
    const result: any = await env.AI.run(env.NIM_MODEL, {
      messages: [
        { role: 'system', content: SEVERITY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 512
    });

    // Defensive extraction matching Council's workers-ai-native-array-output gotcha pattern.
    const rawText =
      result?.response ||
      result?.choices?.[0]?.message?.content ||
      result?.result?.response ||
      '';
    const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);

    if (!text) {
      return {
        severity: 'minor',
        confidence: 0.0,
        signals: [{ signal: 'parse_failed', evidence: `empty AI response: keys=${Object.keys(result || {}).join(',')}` }]
      };
    }

    try {
      const parsed = extractJsonObject(text);
      return parseSafeJudgeResult(parsed);
    } catch {
      return {
        severity: 'minor',
        confidence: 0.0,
        signals: [{ signal: 'parse_failed', evidence: text.slice(0, 200) }]
      };
    }
  } catch (e: any) {
    return {
      severity: 'minor',
      confidence: 0.0,
      signals: [{ signal: 'parse_failed', evidence: String(e?.message ?? e).slice(0, 200) }]
    };
  }
}
