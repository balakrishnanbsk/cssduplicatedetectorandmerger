// Merger — combines duplicate CSS rules into a single combined-selector rule

import { CSSRule } from './parser';
import { DuplicateGroup } from './scanner';

export interface MergeEdit {
  description: string;
  filePath: string;
  originalText: string;
  replacementText: string;
  startOffset: number;
  endOffset: number;
}

export interface MergeResult {
  edits: MergeEdit[];
  before: string;
  after: string;
  description: string;
}

/**
 * Merge a duplicate group: combine all selectors into one rule, remove originals.
 *
 * Before:
 *   .card { padding: 16px; color: red; }
 *   .bard { padding: 16px; color: red; }
 *   .aard { color: red; padding: 16px; }
 *
 * After:
 *   .card, .bard, .aard { padding: 16px; color: red; }
 */
export function mergeDuplicateGroup(group: DuplicateGroup): MergeResult {
  const rules = [...group.rules].sort((a, b) => a.startOffset - b.startOffset);

  const combinedSelector = rules.map(r => r.selector).join(', ');
  // Use the first rule's properties as the canonical ordering
  const first = rules[0];
  const propsText = first.properties
    .map(p => `  ${p.name}: ${p.value}${p.important ? ' !important' : ''};`)
    .join('\n');
  const sharedRule = `${combinedSelector} {\n${propsText}\n}`;

  const before = rules.map(r => r.rawText.trim()).join('\n\n');

  const edits: MergeEdit[] = [];

  // First rule gets replaced with the combined rule
  edits.push({
    description: `Combine into "${combinedSelector}"`,
    filePath: first.filePath,
    originalText: first.rawText,
    replacementText: sharedRule,
    startOffset: first.startOffset,
    endOffset: first.endOffset,
  });

  // All other rules get deleted
  for (let i = 1; i < rules.length; i++) {
    edits.push({
      description: `Remove duplicate "${rules[i].selector}"`,
      filePath: rules[i].filePath,
      originalText: rules[i].rawText,
      replacementText: '',
      startOffset: rules[i].startOffset,
      endOffset: rules[i].endOffset,
    });
  }

  return {
    edits,
    before,
    after: sharedRule,
    description: `Merge ${rules.length} selectors → ${combinedSelector} { ${group.displayKey} }`,
  };
}

/**
 * Apply merge edits to source text (single file).
 * Returns the new source text.
 */
export function applyEditsToSource(sourceText: string, edits: MergeEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.startOffset - a.startOffset);

  let result = sourceText;
  for (const edit of sorted) {
    const before = result.slice(0, edit.startOffset);
    const after = result.slice(edit.endOffset);

    if (edit.replacementText === '') {
      const trailingWs = after.match(/^[\t ]*\r?\n(\r?\n)?/);
      const trimAfter = trailingWs ? after.slice(trailingWs[0].length) : after;
      result = before.replace(/\n\s*$/, '\n') + trimAfter;
    } else {
      result = before + edit.replacementText + after;
    }
  }

  return result;
}
