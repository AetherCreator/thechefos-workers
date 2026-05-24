import type { CostTrajectory, SectionError } from "./schema";
import { isSectionError } from "./schema";

export function renderSection5(cost: CostTrajectory | SectionError): string {
  if (isSectionError(cost)) {
    return `## 5. Cost trajectory\n\n_Error fetching cost-telemetry: ${cost.error}_\n`;
  }

  const tl = cost.traffic_light.toUpperCase();
  const trafficEmoji =
    cost.traffic_light === "green"
      ? "🟢"
      : cost.traffic_light === "yellow"
        ? "🟡"
        : cost.traffic_light === "red"
          ? "🔴"
          : "⬛";

  const rows = Object.entries(cost.by_persona)
    .map(([persona, p]) => `| ${persona} | ${p.used} | ${p.cap} | ${p.percent}% |`)
    .join("\n");

  const woW =
    cost.week_over_week_delta_percent !== null
      ? `**WoW delta:** ${cost.week_over_week_delta_percent > 0 ? "+" : ""}${cost.week_over_week_delta_percent.toFixed(1)}%`
      : "_WoW delta: n/a (no prior week data)_";

  const notables =
    cost.notable.length > 0
      ? `\n**Notable:**\n${cost.notable.map((n) => `- ${n}`).join("\n")}`
      : "";

  return `## 5. Cost trajectory

**Traffic light:** ${trafficEmoji} ${tl} — ${cost.current_week_neurons_used} / ${cost.current_week_neurons_cap} neurons used

| Persona | Used | Cap | % |
|---------|------|-----|---|
${rows}

${woW}${notables}
`;
}

export function renderPlaceholders(cost?: CostTrajectory | SectionError): string {
  const section5 = cost !== undefined ? renderSection5(cost) : `## 5. Cost trajectory

(LIVE METRIC per v1.1 amendment — emit table from cost-telemetry adapter output; show traffic_light + per-persona table + WoW delta if available + notable list)
`;

  return `${section5}
## 6. Council judge calibration

> ⏸️ **Ships with \`OPS-COUNCIL-PERSIST-VERDICTS\`** (partial — base persistence exists).
>
> Council Worker writes via brain-write (\`packages/council/src/index.ts\` line 191). Verdict-payload shape vs reflection-calibration needs is unknown until audited. Once audit confirms shape, reflection can compute inter-rater agreement, persistent extremes, and judge calibration drift from existing data path.

## 7. P1 false-positive rate

> ⏸️ **Ships with P1 (Locke changelog-watcher).** Not yet built.

## 8. P2 voyage success rate

> ⏸️ **Ships with P2 (Voyage Worker).** Not yet built.

## 9. Crew XP / Spirit Level

> ⏸️ **Ships with P5 (RPG mechanic).** Sequenced last per ONETEN v3.`;
}
