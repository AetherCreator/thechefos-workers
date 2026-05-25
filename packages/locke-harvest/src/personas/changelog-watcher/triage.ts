// Triage ladder for changelog-watcher leads → OPS-BOARD placement.
// Per CHARTER §3: severity × criticality → priority/section/telegram/auto_fork_hunt.

import type { ChangelogLead, SeverityLevel, CriticalityLevel } from '../../changelogSchema';

export type TelegramMode = 'immediate' | 'daily_digest' | 'silent';

export interface TriageDecision {
  priority: 'URGENT' | 'Normal' | 'Low';
  section: 'URGENT' | 'BACKLOG';
  telegram: TelegramMode;
  auto_fork_hunt: boolean;
  auto_stale_at?: string;  // ISO date string, set for minor leads
}

// Returns a date string 14 days in the future
function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

export function triage(lead: Pick<ChangelogLead, 'severity' | 'criticality'>): TriageDecision {
  const s: SeverityLevel = lead.severity;
  const c: CriticalityLevel = lead.criticality;

  if (s === 'security_advisory') {
    return { priority: 'URGENT', section: 'URGENT', telegram: 'immediate', auto_fork_hunt: false };
  }

  if (s === 'breaking_change') {
    if (c === 'high') {
      return { priority: 'URGENT', section: 'URGENT', telegram: 'daily_digest', auto_fork_hunt: true };
    }
    // medium or low
    return { priority: 'URGENT', section: 'URGENT', telegram: 'daily_digest', auto_fork_hunt: false };
  }

  if (s === 'deprecation') {
    return { priority: 'Normal', section: 'BACKLOG', telegram: 'silent', auto_fork_hunt: false };
  }

  // minor
  return {
    priority: 'Low',
    section: 'BACKLOG',
    telegram: 'silent',
    auto_fork_hunt: false,
    auto_stale_at: futureDate(14),
  };
}
