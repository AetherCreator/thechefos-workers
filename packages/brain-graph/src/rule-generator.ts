// packages/brain-graph/src/rule-generator.ts
// Clue 2: Rule Template Generator — generates .claude/rules/ file content from graduated patterns

import type { NodeRow } from './queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraduatedPattern {
  pattern_id: string;
  name: string;
  description: string;
  domains: string[];
  contributing_nodes: Array<{
    id: string;
    title: string;
    domain: string;
    type: string;
  }>;
}

export interface RuleFile {
  filename: string;
  content: string;
  target_repo: string;
  target_path: string;
}

// ---------------------------------------------------------------------------
// Domain → Repo + Path Mapping
// ---------------------------------------------------------------------------

interface RepoTarget {
  repo: string;
  paths: string[];
  pathPrefix: string;
}

const DOMAIN_REPO_MAP: Record<string, RepoTarget> = {
  chef: { repo: 'AetherCreator/chefos', paths: ['src/**'], pathPrefix: 'src/' },
  cooking: { repo: 'AetherCreator/chefos', paths: ['src/**'], pathPrefix: 'src/' },
  recipes: { repo: 'AetherCreator/chefos', paths: ['src/**'], pathPrefix: 'src/' },
  gamedev: { repo: 'AetherCreator/aether-chronicles', paths: ['scripts/**'], pathPrefix: 'scripts/' },
  'game-design': { repo: 'AetherCreator/aether-chronicles', paths: ['scripts/**'], pathPrefix: 'scripts/' },
  aether: { repo: 'AetherCreator/aether-chronicles', paths: ['scripts/**'], pathPrefix: 'scripts/' },
  meta: { repo: 'AetherCreator/SuperClaude', paths: ['**/*'], pathPrefix: '' },
  system: { repo: 'AetherCreator/SuperClaude', paths: ['**/*'], pathPrefix: '' },
  workflow: { repo: 'AetherCreator/SuperClaude', paths: ['**/*'], pathPrefix: '' },
  infra: { repo: 'AetherCreator/thechefos-workers', paths: ['packages/**'], pathPrefix: 'packages/' },
  infrastructure: { repo: 'AetherCreator/thechefos-workers', paths: ['packages/**'], pathPrefix: 'packages/' },
  workers: { repo: 'AetherCreator/thechefos-workers', paths: ['packages/**'], pathPrefix: 'packages/' },
};

const DEFAULT_TARGET: RepoTarget = {
  repo: 'AetherCreator/SuperClaude',
  paths: ['**/*'],
  pathPrefix: '',
};

// ---------------------------------------------------------------------------
// Core: generateRule
// ---------------------------------------------------------------------------

export function generateRule(pattern: GraduatedPattern): RuleFile[] {
  // Group domains by target repo
  const repoGroups = new Map<string, { target: RepoTarget; domains: string[] }>();

  for (const domain of pattern.domains) {
    const target = DOMAIN_REPO_MAP[domain] || DEFAULT_TARGET;
    const existing = repoGroups.get(target.repo);
    if (existing) {
      existing.domains.push(domain);
    } else {
      repoGroups.set(target.repo, { target, domains: [domain] });
    }
  }

  const rules: RuleFile[] = [];
  const date = new Date().toISOString().split('T')[0];

  for (const [repo, { target, domains }] of repoGroups) {
    // Filter contributing nodes relevant to this repo's domains
    const relevantNodes = pattern.contributing_nodes.filter((n) =>
      domains.includes(n.domain) ||
      // Include nodes if their domain maps to the same repo
      (DOMAIN_REPO_MAP[n.domain]?.repo || DEFAULT_TARGET.repo) === repo
    );

    // If no relevant nodes, include all (cross-domain pattern)
    const nodes = relevantNodes.length > 0 ? relevantNodes : pattern.contributing_nodes;

    const nodeList = nodes
      .slice(0, 10)
      .map((n) => `${n.id} (${n.title})`)
      .join(', ');

    const principle = buildPrinciple(pattern, domains, nodes);
    const whenApplies = buildWhenApplies(pattern, domains);
    const verifyChecks = buildVerifyChecks(pattern, domains);

    const pathsYaml = target.paths.map((p) => `"${p}"`).join(', ');

    const content = [
      '---',
      `paths:`,
      `  - ${target.paths.map((p) => `"${p}"`).join('\n  - ')}`,
      'alwaysApply: false',
      '---',
      '',
      `# Rule: ${pattern.name}`,
      `Graduated: ${date} | Source: brain/ pattern detection`,
      `Contributing nodes: ${nodeList}`,
      '',
      '## Principle',
      principle,
      '',
      '## When This Applies',
      whenApplies,
      '',
      '## verify:',
      ...verifyChecks.map((check) => `- ${check}`),
      '',
    ].join('\n');

    // Filename: sanitized pattern name
    const filename = `instinct-${pattern.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;

    rules.push({
      filename,
      content,
      target_repo: repo,
      target_path: `.claude/rules/${filename}`,
    });
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Content Builders
// ---------------------------------------------------------------------------

function buildPrinciple(
  pattern: GraduatedPattern,
  domains: string[],
  nodes: Array<{ id: string; title: string; domain: string; type: string }>
): string {
  const domainStr = domains.join(', ');
  const nodeTypes = [...new Set(nodes.map((n) => n.type))];
  const typeStr = nodeTypes.join(', ');

  // Build a meaningful principle from the pattern data
  if (nodeTypes.length === 1) {
    return (
      `The "${nodeTypes[0]}" pattern appears consistently across ${domainStr} domains. ` +
      `This cross-domain recurrence (${nodes.length} nodes) indicates a fundamental principle ` +
      `that should be applied uniformly regardless of which product or system is being modified.`
    );
  }

  return (
    `Pattern "${pattern.name}" spans ${domainStr} domains with ${nodes.length} contributing nodes ` +
    `of types: ${typeStr}. This convergence suggests a shared design principle that should ` +
    `guide decisions across these domains to maintain consistency and leverage proven approaches.`
  );
}

function buildWhenApplies(pattern: GraduatedPattern, domains: string[]): string {
  const scenarios: string[] = [];

  for (const domain of domains) {
    switch (domain) {
      case 'chef':
      case 'cooking':
      case 'recipes':
        scenarios.push('- When modifying ChefOS recipe logic, AI gateway prompts, or food-related features');
        break;
      case 'gamedev':
      case 'game-design':
      case 'aether':
        scenarios.push('- When working on Aether Chronicles game mechanics, battle systems, or entity design');
        break;
      case 'meta':
      case 'system':
      case 'workflow':
        scenarios.push('- When editing brain/ nodes, SuperClaude skills, or system-level configuration');
        break;
      case 'infra':
      case 'infrastructure':
      case 'workers':
        scenarios.push('- When modifying Cloudflare Workers, router dispatch, or backend API endpoints');
        break;
      default:
        scenarios.push(`- When working in the ${domain} domain`);
        break;
    }
  }

  // Deduplicate
  return [...new Set(scenarios)].join('\n');
}

function buildVerifyChecks(pattern: GraduatedPattern, domains: string[]): string[] {
  const checks: string[] = [];
  const date = new Date().toISOString().split('T')[0];

  // Always include a pattern-existence check
  checks.push(
    `Pattern "${pattern.name}" nodes still active in brain/ graph [added: ${date}]`
  );

  // Domain-specific verify suggestions
  if (domains.some((d) => ['chef', 'cooking', 'recipes'].includes(d))) {
    checks.push(
      `Cross-domain consistency maintained between ChefOS and related domains [added: ${date}]`
    );
  }
  if (domains.some((d) => ['gamedev', 'game-design', 'aether'].includes(d))) {
    checks.push(
      `Game design patterns aligned with corresponding infrastructure patterns [added: ${date}]`
    );
  }
  if (domains.some((d) => ['infra', 'infrastructure', 'workers'].includes(d))) {
    checks.push(
      `Infrastructure changes follow the cross-domain principle [added: ${date}]`
    );
  }

  return checks;
}
