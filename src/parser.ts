// CSS Parser — extracts rules with selectors and properties from CSS/SCSS/LESS files
// Uses css-tree for robust parsing

import * as cssTree from 'css-tree';

export interface CSSProperty {
  name: string;
  value: string;
  important: boolean;
  line: number;
  column: number;
}

export interface CSSRule {
  /** The full selector text, e.g. ".card" or ".box > .inner" */
  selector: string;
  properties: CSSProperty[];
  filePath: string;
  /** 1-based line of the rule start */
  line: number;
  column: number;
  /** Byte offset of the rule start in the source text */
  startOffset: number;
  /** Byte offset of the rule end (after closing brace) */
  endOffset: number;
  /** The full raw text of this rule block */
  rawText: string;
}

export interface ParsedStylesheet {
  filePath: string;
  rules: CSSRule[];
}

/**
 * Parse a CSS/SCSS/LESS file and extract all rules.
 */
export function parseCSS(cssText: string, filePath: string): ParsedStylesheet {
  const rules: CSSRule[] = [];
  extractRules(cssText, filePath, '', rules, 0, cssText);
  return { filePath, rules };
}

/**
 * Recursively extract rules, handling LESS/SCSS nesting.
 * parentSelector is prepended to nested selectors (e.g. ".parent" → ".parent .child").
 * baseOffset is the character offset of `text` within the original source.
 * fullSource is the original unmodified source text used to compute baseLine.
 */
function extractRules(
  text: string,
  filePath: string,
  parentSelector: string,
  rules: CSSRule[],
  baseOffset: number = 0,
  fullSource: string = text
): void {
  // Compute how many lines precede this chunk in the original source
  const baseLine = baseOffset > 0 ? fullSource.slice(0, baseOffset).split('\n').length - 1 : 0;

  try {
    const ast = cssTree.parse(text, {
      positions: true,
      filename: filePath,
      onParseError: () => { /* silently skip malformed rules */ },
    });

    // Use manual traversal to track parent selector context
    walkRules(ast, text, filePath, parentSelector, rules, baseOffset, baseLine, fullSource);
  } catch {
    // If parsing fails completely, try regex fallback for nested rules
    extractRulesRegex(text, filePath, parentSelector, rules, baseOffset, baseLine, fullSource);
  }
}

/**
 * Manually walk AST nodes to process rules with parent selector context.
 * Unlike cssTree.walk, this tracks nesting so child selectors get combined
 * with their parent (e.g. .parent + .child → .parent .child).
 */
function walkRules(
  node: cssTree.CssNode,
  sourceText: string,
  filePath: string,
  parentSelector: string,
  rules: CSSRule[],
  baseOffset: number,
  baseLine: number,
  fullSource: string
): void {
  // Walk children of StyleSheet, Block, or Atrule
  if (node.type === 'StyleSheet' || node.type === 'Block') {
    const children = (node as any).children;
    if (children) {
      children.forEach((child: cssTree.CssNode) => {
        walkRules(child, sourceText, filePath, parentSelector, rules, baseOffset, baseLine, fullSource);
      });
    }
    return;
  }

  if (node.type === 'Atrule') {
    if (node.block) {
      walkRules(node.block, sourceText, filePath, parentSelector, rules, baseOffset, baseLine, fullSource);
    }
    return;
  }

  if (node.type !== 'Rule' || !node.prelude || node.prelude.type !== 'SelectorList') {
    return;
  }
  const block = node.block;
  if (!block || block.type !== 'Block') { return; }

  // Extract direct property declarations
  const properties: CSSProperty[] = [];
  block.children.forEach((child) => {
    if (child.type === 'Declaration') {
      properties.push({
        name: child.property,
        value: cssTree.generate(child.value).trim(),
        important: child.important === true,
        line: child.loc?.start.line ?? 0,
        column: child.loc?.start.column ?? 0,
      });
    }
  });

  const localSelector = cssTree.generate(node.prelude);
  const fullSelector = parentSelector
    ? combineSelectors(parentSelector, localSelector)
    : localSelector;

  const startOffset = (node.loc?.start.offset ?? 0) + baseOffset;
  const endOffset = (node.loc?.end.offset ?? 0) + baseOffset;

  // Add this rule if it has own properties
  if (properties.length > 0) {
    const rawText = sourceText.slice(
      node.loc?.start.offset ?? 0,
      node.loc?.end.offset ?? 0
    );
    rules.push({
      selector: fullSelector,
      properties,
      filePath,
      line: (node.loc?.start.line ?? 0) + baseLine,
      column: node.loc?.start.column ?? 0,
      startOffset,
      endOffset,
      rawText,
    });
  }

  // Recurse into nested rules and raw blocks with this rule's selector as parent
  block.children.forEach((child) => {
    if (child.type === 'Rule') {
      walkRules(child, sourceText, filePath, fullSelector, rules, baseOffset, baseLine, fullSource);
    } else if (child.type === 'Raw') {
      const rawOffset = (child.loc?.start.offset ?? 0) + baseOffset;
      extractRules(child.value, filePath, fullSelector, rules, rawOffset, fullSource);
    }
  });
}

/**
 * Regex-based fallback for extracting rules from unparseable nested content.
 */
function extractRulesRegex(
  text: string,
  filePath: string,
  parentSelector: string,
  rules: CSSRule[],
  baseOffset: number,
  baseLine: number,
  fullSource: string
): void {
  // Match: selector { declarations }
  const ruleRegex = /([^{}]+?)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRegex.exec(text)) !== null) {
    const selector = match[1].trim();
    const body = match[2].trim();
    if (!selector || !body) { continue; }

    const fullSelector = parentSelector
      ? combineSelectors(parentSelector, selector)
      : selector;

    const properties: CSSProperty[] = [];
    const declRegex = /([\w-]+)\s*:\s*([^;]+?)(?:\s*(!important))?\s*;/g;
    let dm;
    while ((dm = declRegex.exec(body)) !== null) {
      const linesBefore = text.slice(0, match.index + match[0].indexOf(dm[0])).split('\n');
      properties.push({
        name: dm[1],
        value: dm[2].trim(),
        important: !!dm[3],
        line: linesBefore.length + baseLine,
        column: 1,
      });
    }

    if (properties.length > 0) {
      const ruleStart = match.index + baseOffset;
      const ruleEnd = ruleStart + match[0].length;
      rules.push({
        selector: fullSelector,
        properties,
        filePath,
        line: text.slice(0, match.index).split('\n').length + baseLine,
        column: 1,
        startOffset: ruleStart,
        endOffset: ruleEnd,
        rawText: match[0],
      });
    }
  }
}

/**
 * Combine parent and child selectors for LESS/SCSS nesting.
 * Handles & (parent reference): ".parent" + "&.active" → ".parent.active"
 * Without &: ".parent" + ".child" → ".parent .child"
 */
function combineSelectors(parent: string, child: string): string {
  if (child.includes('&')) {
    return child.replace(/&/g, parent);
  }
  return parent + ' ' + child;
}

/**
 * Normalize a property value for comparison: trim, lowercase, collapse whitespace.
 */
export function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Build a canonical "property signature" for a rule's property set.
 * Returns sorted "propName:normalizedValue" entries.
 */
export function buildPropertySignature(properties: CSSProperty[]): string[] {
  return properties
    .map(p => `${p.name.toLowerCase()}:${normalizeValue(p.value)}${p.important ? '!important' : ''}`)
    .sort();
}

/**
 * Shorten a file path for display.
 */
export function shortenPath(filePath: string): string {
  const parts = filePath.split('/');
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : filePath;
}
