// Scanner — detects duplicate CSS rules (selectors with identical property sets)
//
// Groups rules whose complete property sets match exactly (order-insensitive).
// e.g. .card { padding: 16px; color: red; } and .bard { padding: 16px; color: red; }

import { CSSRule, buildPropertySignature, shortenPath } from './parser';

/** A group of rules that share the exact same set of properties */
export interface DuplicateGroup {
  /** Sorted property signature entries, e.g. ["color:red", "padding:16px"] */
  signature: string[];
  /** Human-readable display: "padding: 16px; color: red" */
  displayKey: string;
  /** All rules with this exact property set */
  rules: CSSRule[];
}

export interface ScanReport {
  /** All duplicate groups */
  duplicates: DuplicateGroup[];
  /** Total number of duplicate groups */
  totalGroups: number;
  /** Total individual rules involved in duplicates */
  totalRules: number;
}

/**
 * Scan CSS rules for duplicate rule blocks (identical property sets).
 * Two rules are duplicates if they have the exact same set of property:value
 * pairs (order-insensitive, !important-sensitive).
 */
export function scanForDuplicates(rules: CSSRule[]): ScanReport {
  const sigMap = new Map<string, CSSRule[]>();

  for (const rule of rules) {
    // Only detect full duplicates: require at least 2 properties
    if (rule.properties.length < 2) { continue; }
    const sig = buildPropertySignature(rule.properties);
    const key = sig.join('|');
    if (!sigMap.has(key)) {
      sigMap.set(key, []);
    }
    sigMap.get(key)!.push(rule);
  }

  const duplicates: DuplicateGroup[] = [];

  for (const [, groupRules] of sigMap) {
    if (groupRules.length < 2) { continue; }

    const sig = buildPropertySignature(groupRules[0].properties);
    const display = groupRules[0].properties
      .map(p => `${p.name}: ${p.value}${p.important ? ' !important' : ''}`)
      .join('; ');

    duplicates.push({
      signature: sig,
      displayKey: display,
      rules: groupRules,
    });
  }

  // Sort: most occurrences first, then alphabetically
  duplicates.sort((a, b) => {
    if (b.rules.length !== a.rules.length) {
      return b.rules.length - a.rules.length;
    }
    return a.displayKey.localeCompare(b.displayKey);
  });

  const totalRules = duplicates.reduce((sum, g) => sum + g.rules.length, 0);

  return {
    duplicates,
    totalGroups: duplicates.length,
    totalRules,
  };
}

/**
 * Build a human-readable summary.
 */
export function buildScanSummary(report: ScanReport): string {
  const lines: string[] = [];
  lines.push('CSS Duplicate Rule Scan');
  lines.push('══════════════════════════');
  lines.push(`Duplicate groups: ${report.totalGroups}`);
  lines.push(`Total rules:      ${report.totalRules}`);
  lines.push('');

  for (const group of report.duplicates) {
    lines.push(`── { ${group.displayKey} } (${group.rules.length}×) ──`);
    for (const rule of group.rules) {
      lines.push(`  • ${rule.selector}  (${shortenPath(rule.filePath)}:${rule.line})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
