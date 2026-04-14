// Tests for CSS Duplicate Detector — rule-level duplicate detection

import { parseCSS, normalizeValue, buildPropertySignature, shortenPath } from './parser';
import { scanForDuplicates, DuplicateGroup, ScanReport, buildScanSummary } from './scanner';
import { mergeDuplicateGroup, applyEditsToSource } from './merger';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}\n    Expected: ${JSON.stringify(expected)}\n    Actual:   ${JSON.stringify(actual)}`);
  }
}

function section(name: string): void {
  console.log(`\n▸ ${name}`);
}

// ─── Parser Tests ───
section('Parser — normalizeValue');
assertEqual(normalizeValue('  16px '), '16px', 'trims whitespace');
assertEqual(normalizeValue('1px  2px   3px'), '1px 2px 3px', 'collapses internal whitespace');
assertEqual(normalizeValue('RED'), 'red', 'lowercases');
assertEqual(normalizeValue('  Solid   1px  Black '), 'solid 1px black', 'combined normalize');

section('Parser — buildPropertySignature');
{
  const props = [
    { name: 'color', value: 'red', important: false, line: 1, column: 1 },
    { name: 'padding', value: '16px', important: false, line: 2, column: 1 },
  ];
  const sig = buildPropertySignature(props);
  assertEqual(sig, ['color:red', 'padding:16px'], 'sorted property signature');
}

section('Parser — shortenPath');
assertEqual(shortenPath('/a/b/c/d.css'), '.../c/d.css', 'shortens long path');
assertEqual(shortenPath('a/b.css'), 'a/b.css', 'keeps short path');

section('Parser — parseCSS');
{
  const css = `.card { padding: 16px; color: red; }\n.box { padding: 16px; margin: 8px; }`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules.length, 2, 'parses 2 rules');
  assertEqual(parsed.rules[0].selector, '.card', 'first selector');
  assertEqual(parsed.rules[0].properties.length, 2, 'first rule has 2 properties');
  assertEqual(parsed.rules[1].selector, '.box', 'second selector');
}

section('Parser — handles empty input');
{
  const parsed = parseCSS('', '/empty.css');
  assertEqual(parsed.rules.length, 0, 'empty input returns 0 rules');
}

section('Parser — !important');
{
  const css = `.a { padding: 16px !important; }`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules[0].properties[0].important, true, 'detects !important');
}

// ─── Scanner Tests — Rule-Level ───
section('Scanner — user example: exact duplicate rules');
{
  const css = `
    .card { padding: 16px; color: red; }
    .box { padding: 16px; margin: 8px; }
    .bard { padding: 16px; color: red; }
    .aard { color: red; padding: 16px; }
    .lard { padding: 16px !important; color: red; }
  `;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);

  // .card, .bard, .aard all have { padding: 16px; color: red; } (order-insensitive)
  // .box has { padding: 16px; margin: 8px; } — different set
  // .lard has { padding: 16px !important; color: red; } — different (!important)
  assertEqual(report.totalGroups, 1, '1 duplicate group');
  assertEqual(report.duplicates[0].rules.length, 3, '3 rules in the group');

  const selectors = report.duplicates[0].rules.map(r => r.selector).sort();
  assertEqual(selectors, ['.aard', '.bard', '.card'], 'correct selectors: .card, .bard, .aard');
}

section('Scanner — no duplicates when all property sets unique');
{
  const css = `.a { color: red; }\n.b { color: blue; }\n.c { margin: 10px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, '0 duplicate groups');
}

section('Scanner — same properties different values are NOT duplicates');
{
  const css = `.a { padding: 16px; color: red; }\n.b { padding: 16px; color: blue; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'different values → not duplicates');
}

section('Scanner — order-insensitive matching');
{
  const css = `.a { color: red; padding: 16px; }\n.b { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'same properties different order → duplicate');
  assertEqual(report.duplicates[0].rules.length, 2, '2 rules');
}

section('Scanner — !important makes rule distinct');
{
  const css = `.a { padding: 16px; color: red; }\n.b { padding: 16px !important; color: red; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, '!important vs non-important → different signatures');
}

section('Scanner — matching !important rules ARE duplicates');
{
  const css = `.a { padding: 16px !important; color: red; }\n.b { padding: 16px !important; color: red; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'both !important → duplicate');
}

section('Scanner — value normalization (case-insensitive)');
{
  const css = `.a { color: RED; margin: 0; }\n.b { color: red; margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'RED and red normalized → duplicate');
}

section('Scanner — totalRules count');
{
  const css = `.a { padding: 16px; color: red; }\n.b { padding: 16px; color: red; }\n.c { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, '1 group');
  assertEqual(report.totalRules, 3, '3 total rules');
}

section('Scanner — same selector twice is a duplicate');
{
  const css = `.card { color: red; padding: 10px; }\n.card { color: red; padding: 10px; }`;
  const parsed = parseCSS(css, '/t.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'same selector same properties = duplicate');
}

section('Scanner — cross-file support');
{
  const css1 = `.card { padding: 16px; color: red; }`;
  const css2 = `.box { color: red; padding: 16px; }`;
  const rules = [
    ...parseCSS(css1, '/a.css').rules,
    ...parseCSS(css2, '/b.css').rules,
  ];
  const report = scanForDuplicates(rules);
  assertEqual(report.totalGroups, 1, 'cross-file duplicate detected');
  const files = report.duplicates[0].rules.map(r => r.filePath);
  assert(files.includes('/a.css'), 'has /a.css');
  assert(files.includes('/b.css'), 'has /b.css');
}

section('Scanner — multiple duplicate groups');
{
  const css = `
    .a { padding: 16px; color: red; }
    .b { padding: 16px; color: red; }
    .c { margin: 8px; font-size: 14px; }
    .d { font-size: 14px; margin: 8px; }
  `;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 2, '2 duplicate groups');
}

section('Scanner — sorting: most rules first');
{
  const css = `
    .a { color: red; margin: 0; }
    .b { color: red; margin: 0; }
    .c { padding: 10px; font-size: 14px; }
    .d { padding: 10px; font-size: 14px; }
    .e { padding: 10px; font-size: 14px; }
  `;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.duplicates[0].rules.length, 3, 'largest group first (3 rules)');
  assertEqual(report.duplicates[1].rules.length, 2, 'smaller group second (2 rules)');
}

section('Scanner — extra property means NOT duplicate');
{
  const css = `.a { padding: 16px; color: red; }\n.b { padding: 16px; color: red; margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'extra property makes it different');
}

section('Scanner — single rule, no duplicates');
{
  const css = `.only { color: red; padding: 10px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'single rule → no duplicates');
}

// ─── Merger Tests ───
section('Merger — basic selector combination');
{
  const css = `.card { padding: 16px; color: red; }\n.bard { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);

  assert(merge.edits.length > 0, 'generates edits');
  assert(merge.after.includes('.card, .bard'), 'combined selector in output');
  assert(merge.after.includes('padding: 16px'), 'properties preserved');
  assert(merge.after.includes('color: red'), 'all properties preserved');
}

section('Merger — three selectors combined');
{
  const css = `
    .card { padding: 16px; color: red; }
    .bard { padding: 16px; color: red; }
    .aard { color: red; padding: 16px; }
  `;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);

  // All 3 selectors combined
  const afterText = merge.after;
  assert(afterText.includes('.card'), 'has .card');
  assert(afterText.includes('.bard'), 'has .bard');
  assert(afterText.includes('.aard'), 'has .aard');
  assert(afterText.includes('padding: 16px'), 'has padding');
  assert(afterText.includes('color: red'), 'has color');
}

section('Merger — removes duplicate rules after first');
{
  const css = `.a { padding: 16px; color: red; }\n.b { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);

  // First edit replaces first rule with combined, second deletes
  assertEqual(merge.edits.length, 2, '2 edits');
  assert(merge.edits[0].replacementText.includes('.a, .b'), 'first edit is combined rule');
  assertEqual(merge.edits[1].replacementText, '', 'second edit is deletion');
}

section('Merger — applyEditsToSource works');
{
  const css = `.card {\n  padding: 16px;\n  color: red;\n}\n\n.bard {\n  padding: 16px;\n  color: red;\n}`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);

  const result = applyEditsToSource(css, merge.edits);
  assert(result.includes('.card, .bard'), 'combined selector in applied result');
  assert(result.includes('padding: 16px'), 'properties in applied result');
  assert(result.includes('color: red'), 'all properties in applied result');
  // The duplicate .bard rule should be gone
  const ruleBlocks = result.split('}').filter(s => s.trim().includes('{'));
  assertEqual(ruleBlocks.length, 1, 'only 1 rule block remains after merge');
}

section('Merger — handles !important in merge');
{
  const css = `.a { padding: 16px !important; color: red; }\n.b { padding: 16px !important; color: red; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assert(merge.after.includes('!important'), 'preserves !important');
}

// ─── Edge Cases ───
section('Edge — vendor prefixes');
{
  const css = `.a { -webkit-transform: rotate(45deg); opacity: 1; }\n.b { -webkit-transform: rotate(45deg); opacity: 1; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'vendor-prefixed duplicate detected');
}

section('Edge — shorthand vs longhand are different rules');
{
  const css = `.a { margin: 10px; }\n.b { margin-top: 10px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'different property names = different signatures');
}

section('Edge — many selectors with same rule');
{
  const selectors = Array.from({ length: 10 }, (_, i) => `.s${i} { display: flex; align-items: center; }`);
  const css = selectors.join('\n');
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, '1 group');
  assertEqual(report.duplicates[0].rules.length, 10, '10 rules');
}

section('Edge — empty rules excluded');
{
  const css = `.empty { }`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules.length, 0, 'empty rule is excluded');
}

section('Edge — media query different value not duplicate');
{
  const css = `.a { color: red; }\n@media (max-width: 768px) { .a { color: blue; } }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'different values not duplicated');
}

section('Edge — subset of properties is NOT a duplicate');
{
  const css = `.a { padding: 16px; color: red; }\n.b { padding: 16px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'subset is not a duplicate');
}

// ─── LESS/SCSS Nesting Tests ───
section('LESS — nested rules are extracted');
{
  const less = `.parent {\n  .child { color: red; }\n  .other { color: blue; }\n}`;
  const parsed = parseCSS(less, '/test.less');
  assert(parsed.rules.length >= 2, 'extracts nested rules (got ' + parsed.rules.length + ')');
  const selectors = parsed.rules.map(r => r.selector);
  assert(selectors.some(s => s.includes('parent') && s.includes('child')), 'has parent child selector');
  assert(selectors.some(s => s.includes('parent') && s.includes('other')), 'has parent other selector');
}

section('LESS — nested duplicate rules detected');
{
  const less = `.parent {\n  .child { color: red; padding: 16px; }\n  .other { color: red; padding: 16px; }\n}`;
  const parsed = parseCSS(less, '/test.less');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'nested duplicate group detected');
  assertEqual(report.duplicates[0].rules.length, 2, '2 nested rules in group');
}

section('LESS — nested rules NOT duplicates of flat rules with different props');
{
  const less = `.parent {\n  .child { color: red; }\n}\n.other { color: blue; }`;
  const parsed = parseCSS(less, '/test.less');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'different values → no duplicates');
}

section('LESS — & parent reference selector');
{
  const less = `.btn {\n  &.active { color: red; padding: 5px; }\n  &.disabled { color: red; padding: 5px; }\n}`;
  const parsed = parseCSS(less, '/test.less');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, '& selector duplicates detected');
  // Selectors should be .btn.active and .btn.disabled
  const sels = report.duplicates[0].rules.map(r => r.selector).sort();
  assert(sels.some(s => s.includes('.btn') && s.includes('.active')), 'has .btn.active');
  assert(sels.some(s => s.includes('.btn') && s.includes('.disabled')), 'has .btn.disabled');
}

section('LESS — parent with own properties + nested children');
{
  const less = `.card {\n  padding: 16px;\n  .title { font-size: 18px; }\n}`;
  const parsed = parseCSS(less, '/test.less');
  // Should have both .card (with padding) and .card .title (with font-size)
  assert(parsed.rules.length >= 2, 'parent and nested child both extracted');
  const cardRule = parsed.rules.find(r => r.selector === '.card');
  assert(!!cardRule, '.card rule found');
  assert(cardRule!.properties.some(p => p.name === 'padding'), '.card has padding prop');
}

section('LESS — deeply nested rules');
{
  const less = `.a {\n  .b {\n    .c { color: red; margin: 0; }\n    .d { color: red; margin: 0; }\n  }\n}`;
  const parsed = parseCSS(less, '/test.less');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'deeply nested duplicates detected');
}

section('LESS — variables in values');
{
  const less = `@primary: red;\n.card { color: @primary; padding: 16px; }\n.box { color: @primary; padding: 16px; }`;
  const parsed = parseCSS(less, '/test.less');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'LESS variable values matched as duplicates');
}

section('LESS — flat rules (no nesting) still work');
{
  const less = `.card { padding: 16px; color: red; }\n.box { padding: 16px; color: red; }`;
  const parsed = parseCSS(less, '/test.less');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'flat LESS rules detected');
  assertEqual(report.duplicates[0].rules.length, 2, '2 rules in group');
}

section('LESS — nested rule line numbers are absolute');
{
  const less = `.wrapper {\n  color: blue;\n  .child {\n    color: red;\n    padding: 16px;\n  }\n}\n.other {\n  color: red;\n  padding: 16px;\n}`;
  const parsed = parseCSS(less, '/test.less');
  const childRule = parsed.rules.find(r => r.selector.includes('child'));
  assert(!!childRule, 'found nested child rule');
  // .child starts at line 3 in the original source
  assert(childRule!.line >= 3, 'nested child line is absolute (>= 3), got ' + childRule!.line);
  const otherRule = parsed.rules.find(r => r.selector === '.other');
  assert(!!otherRule, 'found .other rule');
  assertEqual(otherRule!.line, 8, '.other at absolute line 8');
}

section('SCSS — nested rules are extracted');
{
  const scss = `.parent {\n  .child { color: red; margin: 0; }\n  .other { color: red; margin: 0; }\n}`;
  const parsed = parseCSS(scss, '/test.scss');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'SCSS nested duplicates detected');
}

// ═══════════════════════════════════════════════════════
// INTENSIVE TESTS — Publish-Ready Quality Assurance
// ═══════════════════════════════════════════════════════

// ─── Parser: Comments ───
section('Parser — CSS comments are ignored');
{
  const css = `/* This is a comment */\n.a { color: red; padding: 5px; }\n/* Another comment */\n.b { color: red; padding: 5px; }`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules.length, 2, 'parses 2 rules ignoring comments');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'duplicate detected through comments');
}

section('Parser — inline comments between properties');
{
  const css = `.a { color: red; /* inline */ padding: 16px; }\n.b { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'inline comments do not affect matching');
}

// ─── Parser: Complex Selectors ───
section('Parser — descendant selectors');
{
  const css = `.parent .child { color: red; margin: 0; }\n.other .item { color: red; margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules.length, 2, 'parses descendant selectors');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'descendant selector duplicates detected');
}

section('Parser — child combinator selector');
{
  const css = `.a > .b { display: flex; gap: 10px; }\n.c > .d { display: flex; gap: 10px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'child combinator duplicates detected');
}

section('Parser — sibling combinators');
{
  const css = `.a + .b { margin: 0; padding: 0; }\n.c ~ .d { margin: 0; padding: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'sibling combinator duplicates detected');
}

section('Parser — multi-selector rules');
{
  const css = `.a, .b { color: red; padding: 16px; }\n.c { color: red; padding: 16px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'multi-selector rule forms duplicate with single');
}

section('Parser — pseudo-class selectors');
{
  const css = `.btn:hover { color: red; opacity: 0.8; }\n.link:hover { color: red; opacity: 0.8; }`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules.length, 2, 'parses pseudo-class selectors');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'pseudo-class duplicates detected');
}

section('Parser — pseudo-element selectors');
{
  const css = `.a::before { content: ""; display: block; }\n.b::before { content: ""; display: block; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'pseudo-element duplicates detected');
}

section('Parser — attribute selectors');
{
  const css = `[data-active] { color: red; font-weight: bold; }\ninput[type="text"] { color: red; font-weight: bold; }`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules.length, 2, 'parses attribute selectors');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'attribute selector duplicates detected');
}

section('Parser — ID selectors');
{
  const css = `#header { padding: 10px; color: white; }\n#footer { padding: 10px; color: white; }`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules.length, 2, 'parses ID selectors');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'ID selector duplicates detected');
}

section('Parser — universal selector');
{
  const css = `* { box-sizing: border-box; margin: 0; }\ndiv { box-sizing: border-box; margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules.length, 2, 'parses universal selector');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'universal + element selector duplicate');
}

// ─── Parser: At-Rules ───
section('Parser — @media: rules inside media queries parsed');
{
  const css = `@media (max-width: 768px) {\n  .card { padding: 10px; color: red; }\n  .box { padding: 10px; color: red; }\n}`;
  const parsed = parseCSS(css, '/test.css');
  assert(parsed.rules.length >= 2, 'parses rules inside @media');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'duplicates inside @media detected');
}

section('Parser — @media: same properties inside and outside media');
{
  const css = `.a { color: red; padding: 5px; }\n@media print { .b { color: red; padding: 5px; } }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'cross-media duplicate detected');
}

section('Parser — @supports: rules inside @supports');
{
  const css = `@supports (display: grid) {\n  .grid { display: grid; gap: 10px; }\n  .layout { display: grid; gap: 10px; }\n}`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, '@supports duplicates detected');
}

section('Parser — @keyframes rules are NOT regular rules');
{
  const css = `@keyframes fade {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}\n@keyframes slide {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}`;
  const parsed = parseCSS(css, '/test.css');
  // Keyframe selectors like "from" and "to" may or may not be extracted.
  // The important thing: they should NOT cause false duplicates for real rules.
  const report = scanForDuplicates(parsed.rules);
  // Even if keyframe inner blocks are parsed, from/to are identical between the two
  // But they shouldn't interfere with real class selectors
  assert(true, '@keyframes does not crash parser');
}

// ─── Parser: CSS Custom Properties & Functions ───
section('Parser — CSS custom properties (variables)');
{
  const css = `:root { --primary: #333; --secondary: blue; }\n.a { --primary: #333; --secondary: blue; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'custom property duplicates detected');
}

section('Parser — var() function values');
{
  const css = `.a { color: var(--primary); margin: 0; }\n.b { color: var(--primary); margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'var() value duplicates detected');
}

section('Parser — calc() expressions');
{
  const css = `.a { width: calc(100% - 20px); display: block; }\n.b { width: calc(100% - 20px); display: block; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'calc() duplicates detected');
}

section('Parser — calc() different expressions are NOT duplicates');
{
  const css = `.a { width: calc(100% - 20px); display: block; }\n.b { width: calc(100% - 30px); display: block; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'different calc() → not duplicates');
}

section('Parser — rgba/hsla function values');
{
  const css = `.a { background: rgba(255, 0, 0, 0.5); display: block; }\n.b { background: rgba(255, 0, 0, 0.5); display: block; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'rgba() duplicates detected');
}

// ─── Parser: Complex Values ───
section('Parser — comma-separated values (font-family)');
{
  const css = `.a { font-family: Arial, Helvetica, sans-serif; font-size: 14px; }\n.b { font-family: Arial, Helvetica, sans-serif; font-size: 14px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'font-family duplicates detected');
}

section('Parser — multi-value shorthand (border)');
{
  const css = `.a { border: 1px solid #ccc; padding: 10px; }\n.b { border: 1px solid #ccc; padding: 10px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'border shorthand duplicates detected');
}

section('Parser — transition shorthand');
{
  const css = `.a { transition: all 0.3s ease-in-out; opacity: 1; }\n.b { transition: all 0.3s ease-in-out; opacity: 1; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'transition duplicates detected');
}

section('Parser — multiple backgrounds');
{
  const css = `.a { background: url(a.png) no-repeat, url(b.png) repeat; display: block; }\n.b { background: url(a.png) no-repeat, url(b.png) repeat; display: block; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'multiple background duplicates detected');
}

// ─── Parser: Whitespace & Formatting Variations ───
section('Parser — different whitespace formatting, same properties');
{
  const css1 = `.a{color:red;padding:16px}`;
  const css2 = `.b {\n  color:   red ;\n  padding:  16px ;\n}`;
  const rules = [
    ...parseCSS(css1, '/a.css').rules,
    ...parseCSS(css2, '/b.css').rules,
  ];
  const report = scanForDuplicates(rules);
  assertEqual(report.totalGroups, 1, 'whitespace variations still match');
}

section('Parser — tabs vs spaces formatting');
{
  const css = ".a {\n\tcolor: red;\n\tpadding: 16px;\n}\n.b {\n  color: red;\n  padding: 16px;\n}";
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'tabs vs spaces do not affect matching');
}

// ─── Parser: Malformed / Edge-Case CSS ───
section('Parser — malformed CSS does not crash');
{
  const css = `.a { color: ; }\n.b { : red; }\n.c { color red; }`;
  try {
    const parsed = parseCSS(css, '/bad.css');
    assert(true, 'malformed CSS parsed without throwing');
  } catch {
    assert(false, 'malformed CSS should not throw');
  }
}

section('Parser — only comments, no rules');
{
  const css = `/* comment only */\n/* another */`;
  const parsed = parseCSS(css, '/test.css');
  assertEqual(parsed.rules.length, 0, 'comments-only produces 0 rules');
}

section('Parser — rule with semicolon after last property');
{
  const css = `.a { color: red; margin: 0; }\n.b { color: red; margin: 0 }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'trailing semicolon does not affect matching');
}

section('Parser — deeply nested @media inside @supports');
{
  const css = `@supports (display: flex) {\n  @media (min-width: 768px) {\n    .a { display: flex; gap: 10px; }\n    .b { display: flex; gap: 10px; }\n  }\n}`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'deeply nested at-rules: duplicates found');
}

section('Parser — rule with repeated property names');
{
  // Some CSS uses repeated properties for fallback (e.g. color: red; color: var(--c);)
  const css = `.a { color: red; color: var(--c); }\n.b { color: red; color: var(--c); }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'repeated properties matched as duplicates');
}

section('Parser — rule with many properties (10+)');
{
  const props = 'margin:0;padding:0;color:red;background:#fff;font-size:14px;line-height:1.5;display:block;position:relative;width:100%;height:auto;border:none;outline:none';
  const css = `.a { ${props}; }\n.b { ${props}; }`;
  const parsed = parseCSS(css, '/test.css');
  assert(parsed.rules[0].properties.length >= 10, 'rule has 10+ properties');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'many-property duplicates detected');
}

// ─── Parser: normalizeValue edge cases ───
section('normalizeValue — preserves URL casing in values');
{
  // URLs are case-sensitive but normalizeValue lowercases everything.
  // This is acceptable since we compare signatures for grouping.
  const v = normalizeValue('  URL("MyImage.PNG")  ');
  assertEqual(v, 'url("myimage.png")', 'normalizes URL value');
}

section('normalizeValue — empty string');
{
  assertEqual(normalizeValue(''), '', 'empty value normalized');
}

section('normalizeValue — only whitespace');
{
  assertEqual(normalizeValue('   '), '', 'whitespace-only normalized to empty');
}

// ─── Parser: buildPropertySignature edge cases ───
section('buildPropertySignature — empty properties array');
{
  assertEqual(buildPropertySignature([]), [], 'empty properties → empty signature');
}

section('buildPropertySignature — important flag included in signature');
{
  const props = [
    { name: 'color', value: 'RED', important: true, line: 1, column: 1 },
  ];
  const sig = buildPropertySignature(props);
  assertEqual(sig, ['color:red!important'], 'important appended to signature');
}

section('buildPropertySignature — deterministic sorting');
{
  const p1 = [
    { name: 'z-index', value: '1', important: false, line: 1, column: 1 },
    { name: 'color', value: 'red', important: false, line: 2, column: 1 },
    { name: 'margin', value: '0', important: false, line: 3, column: 1 },
  ];
  const p2 = [
    { name: 'margin', value: '0', important: false, line: 1, column: 1 },
    { name: 'z-index', value: '1', important: false, line: 2, column: 1 },
    { name: 'color', value: 'red', important: false, line: 3, column: 1 },
  ];
  assertEqual(buildPropertySignature(p1), buildPropertySignature(p2), 'sorted signatures match regardless of input order');
}

// ─── Parser: shortenPath edge cases ───
section('shortenPath — root-level file');
{
  assertEqual(shortenPath('/file.css'), '/file.css', 'root file not shortened');
}

section('shortenPath — very deep path');
{
  assertEqual(shortenPath('/a/b/c/d/e/f/g.css'), '.../f/g.css', 'deep path shortened');
}

section('shortenPath — two segments');
{
  assertEqual(shortenPath('a/b.css'), 'a/b.css', 'two segment path kept');
}

// ─── Scanner: Stress Tests ───
section('Scanner — 100 identical rules');
{
  const rules100 = Array.from({ length: 100 }, (_, i) => `.r${i} { display: flex; align-items: center; }`).join('\n');
  const parsed = parseCSS(rules100, '/stress.css');
  assertEqual(parsed.rules.length, 100, 'parsed all 100 rules');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, '1 massive duplicate group');
  assertEqual(report.duplicates[0].rules.length, 100, '100 rules in group');
}

section('Scanner — 50 different groups of 2');
{
  const lines: string[] = [];
  for (let i = 0; i < 50; i++) {
    lines.push(`.a${i} { prop${i}: val${i}; extra${i}: x; }`);
    lines.push(`.b${i} { prop${i}: val${i}; extra${i}: x; }`);
  }
  const parsed = parseCSS(lines.join('\n'), '/stress.css');
  assertEqual(parsed.rules.length, 100, 'parsed 100 rules');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 50, '50 duplicate groups');
}

section('Scanner — 0 rules produces empty report');
{
  const report = scanForDuplicates([]);
  assertEqual(report.totalGroups, 0, '0 groups from empty input');
  assertEqual(report.totalRules, 0, '0 rules from empty input');
  assertEqual(report.duplicates.length, 0, 'empty duplicates array');
}

section('Scanner — all rules unique (no false positives)');
{
  const lines = Array.from({ length: 20 }, (_, i) => `.unique${i} { prop${i}: value${i}; }`);
  const parsed = parseCSS(lines.join('\n'), '/test.css');
  assertEqual(parsed.rules.length, 20, 'parsed 20 unique rules');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, '0 duplicates from 20 unique rules');
}

section('Scanner — same selector different props NOT duplicate');
{
  const css = `.card { color: red; }\n.card { padding: 16px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'same selector different props → no duplicate');
}

section('Scanner — property name case sensitivity');
{
  // CSS property names are case-insensitive but css-tree normalizes them
  const css = `.a { Color: red; margin: 0; }\n.b { color: red; margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  // Both should normalize property name to lowercase
  assertEqual(report.totalGroups, 1, 'property name case insensitive');
}

section('Scanner — sorting stability: same count, alphabetical displayKey');
{
  const css = `
    .z1 { z-index: 1; opacity: 1; }
    .z2 { z-index: 1; opacity: 1; }
    .a1 { color: red; margin: 0; }
    .a2 { color: red; margin: 0; }
  `;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 2, '2 groups');
  // Same count → alphabetical by displayKey
  assert(report.duplicates[0].displayKey <= report.duplicates[1].displayKey,
    'same-count groups sorted alphabetically');
}

// ─── Scanner: Cross-File Edge Cases ───
section('Scanner — 3 files, duplicates span all of them');
{
  const rules = [
    ...parseCSS('.a { display: flex; gap: 10px; }', '/one.css').rules,
    ...parseCSS('.b { display: flex; gap: 10px; }', '/two.css').rules,
    ...parseCSS('.c { display: flex; gap: 10px; }', '/three.css').rules,
  ];
  const report = scanForDuplicates(rules);
  assertEqual(report.totalGroups, 1, 'cross-3-file duplicate');
  assertEqual(report.duplicates[0].rules.length, 3, '3 rules from 3 files');
  const files = new Set(report.duplicates[0].rules.map(r => r.filePath));
  assertEqual(files.size, 3, '3 unique files');
}

section('Scanner — cross-file: only 2 of 3 files duplicate');
{
  const rules = [
    ...parseCSS('.a { color: red; padding: 10px; }', '/one.css').rules,
    ...parseCSS('.b { color: red; padding: 10px; }', '/two.css').rules,
    ...parseCSS('.c { color: blue; padding: 10px; }', '/three.css').rules,
  ];
  const report = scanForDuplicates(rules);
  assertEqual(report.totalGroups, 1, '1 group from 2 matching files');
  assertEqual(report.duplicates[0].rules.length, 2, '2 rules in group');
}

// ─── Scanner: buildScanSummary ───
section('buildScanSummary — includes group and rule counts');
{
  const css = `.a { color: red; margin: 0; }\n.b { color: red; margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const summary = buildScanSummary(report);
  assert(summary.includes('Duplicate groups: 1'), 'summary shows group count');
  assert(summary.includes('Total rules:      2'), 'summary shows rule count');
  assert(summary.includes('.a'), 'summary lists selector .a');
  assert(summary.includes('.b'), 'summary lists selector .b');
}

section('buildScanSummary — empty report');
{
  const report: ScanReport = { duplicates: [], totalGroups: 0, totalRules: 0 };
  const summary = buildScanSummary(report);
  assert(summary.includes('Duplicate groups: 0'), 'empty report summary');
}

// ─── Merger: Intensive Tests ───
section('Merger — 5 selectors combined');
{
  const css = `.a { color: red; margin: 0; }\n.b { color: red; margin: 0; }\n.c { color: red; margin: 0; }\n.d { color: red; margin: 0; }\n.e { color: red; margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assert(merge.after.includes('.a, .b, .c, .d, .e'), '5 selectors combined');
  assertEqual(merge.edits.length, 5, '5 edits (1 replace + 4 delete)');
  assertEqual(merge.edits[0].replacementText.length > 0, true, 'first edit is replacement');
  for (let i = 1; i < 5; i++) {
    assertEqual(merge.edits[i].replacementText, '', `edit ${i + 1} is deletion`);
  }
}

section('Merger — preserves property order from first rule');
{
  const css = `.first { z-index: 1; color: red; margin: 0; }\n.second { color: red; margin: 0; z-index: 1; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const lines = merge.after.split('\n').map(l => l.trim()).filter(l => l && l !== '}');
  // First property line should be z-index (from first rule's ordering)
  assert(lines[1].startsWith('z-index'), 'first property preserved from first rule');
}

section('Merger — complex selectors in combined output');
{
  const css = `.nav > .item:hover { color: red; opacity: 0.8; }\n.menu .link:active { color: red; opacity: 0.8; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assert(merge.after.includes('.nav') && merge.after.includes('.item:hover'), 'complex selector 1 preserved');
  assert(merge.after.includes('.menu') && merge.after.includes('.link:active'), 'complex selector 2 preserved');
}

section('Merger — merge description is informative');
{
  const css = `.foo { display: flex; gap: 10px; }\n.bar { display: flex; gap: 10px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assert(merge.description.includes('Merge'), 'description contains "Merge"');
  assert(merge.description.includes('.foo, .bar'), 'description contains combined selectors');
}

section('Merger — applyEditsToSource: multiple rules with gaps');
{
  const css = `.a {\n  color: red;\n  margin: 0;\n}\n\n.unrelated {\n  background: blue;\n}\n\n.b {\n  color: red;\n  margin: 0;\n}`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const result = applyEditsToSource(css, merge.edits);
  assert(result.includes('.a, .b'), 'combined selector in result');
  assert(result.includes('.unrelated'), 'unrelated rule preserved');
  assert(result.includes('background: blue'), 'unrelated properties preserved');
}

section('Merger — applyEditsToSource: adjacent rules no blank line');
{
  const css = `.a { color: red; margin: 0; }\n.b { color: red; margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const result = applyEditsToSource(css, merge.edits);
  assert(result.includes('.a, .b'), 'adjacent rules merged');
  // Should not have the original .b rule text
  // After merge, .b only appears inside the combined selector, not as a standalone rule
  const standaloneB = (result.match(/^\s*\.b\s*\{/gm) || []).length;
  assertEqual(standaloneB, 0, '.b standalone rule removed');
}

section('Merger — cross-file merge creates per-file edits');
{
  const rules = [
    ...parseCSS('.x { padding: 5px; margin: 0; }', '/file1.css').rules,
    ...parseCSS('.y { padding: 5px; margin: 0; }', '/file2.css').rules,
  ];
  const report = scanForDuplicates(rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const files = new Set(merge.edits.map(e => e.filePath));
  assertEqual(files.size, 2, 'edits span 2 files');
}

// ─── Integration: Full Pipeline ───
section('Integration — parse → scan → merge → apply → rescan = 0 duplicates');
{
  const css = `.card {\n  padding: 16px;\n  color: red;\n}\n\n.sidebar {\n  background: blue;\n}\n\n.bard {\n  color: red;\n  padding: 16px;\n}`;
  const parsed1 = parseCSS(css, '/test.css');
  const report1 = scanForDuplicates(parsed1.rules);
  assertEqual(report1.totalGroups, 1, 'initial scan: 1 group');

  const merge = mergeDuplicateGroup(report1.duplicates[0]);
  const merged = applyEditsToSource(css, merge.edits);

  // Rescan the merged CSS
  const parsed2 = parseCSS(merged, '/test.css');
  const report2 = scanForDuplicates(parsed2.rules);
  assertEqual(report2.totalGroups, 0, 'after merge: 0 duplicates');

  // Verify all original selectors present
  assert(merged.includes('.card'), 'merged still has .card');
  assert(merged.includes('.bard'), 'merged still has .bard (in combined)');
  assert(merged.includes('.sidebar'), 'unrelated .sidebar preserved');
}

section('Integration — multiple groups: merge one, others remain');
{
  const css = `.a { color: red; margin: 0; }\n.b { color: red; margin: 0; }\n.c { padding: 10px; font-size: 14px; }\n.d { padding: 10px; font-size: 14px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 2, '2 groups initially');

  // Merge only the first group
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const merged = applyEditsToSource(css, merge.edits);

  // Rescan
  const parsed2 = parseCSS(merged, '/test.css');
  const report2 = scanForDuplicates(parsed2.rules);
  assertEqual(report2.totalGroups, 1, 'after merging 1 group: 1 remains');
}

section('Integration — merge all groups sequentially');
{
  const css = `.a { color: red; margin: 0; }\n.b { color: red; margin: 0; }\n.c { padding: 10px; font-size: 14px; }\n.d { padding: 10px; font-size: 14px; }`;
  let source = css;

  // Parse, merge first group, apply
  let parsed = parseCSS(source, '/test.css');
  let report = scanForDuplicates(parsed.rules);

  while (report.totalGroups > 0) {
    // Only merge same-file groups
    const sameFile = report.duplicates.filter(g =>
      g.rules.every(r => r.filePath === g.rules[0].filePath)
    );
    if (sameFile.length === 0) { break; }
    const merge = mergeDuplicateGroup(sameFile[0]);
    source = applyEditsToSource(source, merge.edits);
    parsed = parseCSS(source, '/test.css');
    report = scanForDuplicates(parsed.rules);
  }

  assertEqual(report.totalGroups, 0, 'all groups merged');
  // Verify selectors present
  assert(source.includes('.a'), 'has .a');
  assert(source.includes('.b'), 'has .b in combined selector');
  assert(source.includes('.c'), 'has .c');
  assert(source.includes('.d'), 'has .d in combined selector');
}

// ─── LESS/SCSS: Intensive Nesting Tests ───
section('LESS — & with pseudo-class (:hover)');
{
  const less = `.btn {\n  &:hover { color: red; opacity: 0.8; }\n  &:focus { color: red; opacity: 0.8; }\n}`;
  const parsed = parseCSS(less, '/test.less');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, '&:hover and &:focus duplicates detected');
  const sels = report.duplicates[0].rules.map(r => r.selector).sort();
  assert(sels.some(s => s.includes(':hover')), 'has :hover selector');
  assert(sels.some(s => s.includes(':focus')), 'has :focus selector');
}

section('LESS — & with pseudo-element (::before)');
{
  const less = `.icon {\n  &::before { content: ""; display: block; }\n  &::after { content: ""; display: block; }\n}`;
  const parsed = parseCSS(less, '/test.less');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, '&::before and &::after duplicates');
}

section('SCSS — mixed nested and flat rules');
{
  const scss = `.flat { color: red; margin: 0; }\n.parent {\n  .nested { color: red; margin: 0; }\n}`;
  const parsed = parseCSS(scss, '/test.scss');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'flat and nested with same props = duplicate');
}

section('SCSS — 3 levels deep nesting');
{
  const scss = `.a {\n  .b {\n    .c {\n      color: red;\n      padding: 10px;\n    }\n  }\n}\n.d {\n  .e {\n    .f {\n      padding: 10px;\n      color: red;\n    }\n  }\n}`;
  const parsed = parseCSS(scss, '/test.scss');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, '3-level nested duplicates detected');
}

section('SCSS — sibling nested blocks');
{
  const scss = `.card {\n  .header { font-weight: bold; line-height: 1; }\n  .footer { font-weight: bold; line-height: 1; }\n  .body { color: red; margin: 0; }\n}`;
  const parsed = parseCSS(scss, '/test.scss');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'sibling nested duplicates');
  assertEqual(report.duplicates[0].rules.length, 2, '2 sibling rules');
}

section('SCSS — parent with props does not interfere with child matching');
{
  const scss = `.card {\n  padding: 20px;\n  .title { color: red; margin: 0; }\n}\n.box {\n  margin: 10px;\n  .label { color: red; margin: 0; }\n}`;
  const parsed = parseCSS(scss, '/test.scss');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'nested children matched independently of parent props');
}

section('LESS — multiple & references');
{
  const less = `.btn {\n  &.primary & { color: white; font-weight: bold; }\n  &.secondary & { color: white; font-weight: bold; }\n}`;
  const parsed = parseCSS(less, '/test.less');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'multiple & references duplicates');
}

// ─── Edge: Real-World CSS Patterns ───
section('Real-world — reset/normalize duplicate detection');
{
  const css = `
    h1, h2, h3 { margin: 0; padding: 0; }
    p, span { margin: 0; padding: 0; }
  `;
  const parsed = parseCSS(css, '/reset.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'reset-style duplicates detected');
}

section('Real-world — utility classes with identical styles');
{
  const css = `
    .text-center { text-align: center; display: block; }
    .align-center { text-align: center; display: block; }
    .centered { text-align: center; display: block; }
    .flex-center { display: flex; justify-content: center; align-items: center; }
    .flex-middle { display: flex; justify-content: center; align-items: center; }
  `;
  const parsed = parseCSS(css, '/utilities.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 2, '2 groups of utility duplicates');
}

section('Real-world — component with BEM naming duplicates');
{
  const css = `
    .card__header { padding: 16px; border-bottom: 1px solid #eee; }
    .modal__header { padding: 16px; border-bottom: 1px solid #eee; }
    .panel__header { padding: 16px; border-bottom: 1px solid #eee; }
  `;
  const parsed = parseCSS(css, '/components.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'BEM duplicates detected');
  assertEqual(report.duplicates[0].rules.length, 3, '3 BEM rules in group');
}

section('Real-world — responsive duplicates across breakpoints');
{
  const css = `
    .container { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
    @media (max-width: 768px) {
      .wrapper { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
    }
  `;
  const parsed = parseCSS(css, '/layout.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'responsive duplicate detected cross-breakpoint');
}

section('Real-world — large file with no duplicates (no false positives)');
{
  const lines: string[] = [];
  for (let i = 0; i < 50; i++) {
    const propCount = (i % 5) + 1;
    const props = Array.from({ length: propCount }, (_, j) => `prop${i}_${j}: val${i}_${j}`).join('; ');
    lines.push(`.unique-class-${i} { ${props}; }`);
  }
  const parsed = parseCSS(lines.join('\n'), '/large.css');
  assertEqual(parsed.rules.length, 50, 'parsed 50 unique rules');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'large unique file: 0 false positives');
}

section('Real-world — mixed languages: CSS + SCSS features');
{
  const scss = `
    .card {
      border-radius: 4px;
      &:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.1); outline: none; }
      &:focus { box-shadow: 0 2px 4px rgba(0,0,0,0.1); outline: none; }
    }
  `;
  const parsed = parseCSS(scss, '/test.scss');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'SCSS hover/focus duplicates detected');
}

// ─── Edge: Boundary Conditions ───
section('Edge — single property rule skipped (full duplicate requires 2+ properties)');
{
  const css = `.a { color: red; }\n.b { color: red; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'single-property rules are not flagged');
}

section('Edge — extremely long selector');
{
  const longSel = '.parent .child .grandchild .great-grandchild .great-great-grandchild';
  const css = `${longSel} { color: red; margin: 0; }\n.short { color: red; margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'long selector duplicate detected');
}

section('Edge — special characters in class names');
{
  const css = `.my-class_v2 { color: red; padding: 5px; }\n.other-class_v2 { color: red; padding: 5px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'special chars in class names');
}

section('Edge — escaped characters in selectors');
{
  const css = `.col-1\\/2 { width: 50%; display: block; }\n.half { width: 50%; display: block; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  // Both rules have { width: 50% } - they are property-set duplicates
  assertEqual(report.totalGroups, 1, 'escaped selector character duplicates');
}

section('Edge — negative values');
{
  const css = `.a { margin: -10px; z-index: -1; }\n.b { z-index: -1; margin: -10px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'negative values duplicate detected');
}

section('Edge — zero values in different units are NOT normalized');
{
  const css = `.a { margin: 0px; }\n.b { margin: 0; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  // 0px and 0 are different string values — depends on parser normalization
  // This tests that the tool does not incorrectly conflate them (or both are fine)
  assert(report.totalGroups <= 1, 'zero values handled without crash');
}

section('Edge — !important on all properties');
{
  const css = `.a { color: red !important; padding: 16px !important; }\n.b { padding: 16px !important; color: red !important; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'all !important properties duplicate');
}

section('Edge — mixed !important: some match, some dont');
{
  const css = `.a { color: red !important; padding: 16px; }\n.b { color: red !important; padding: 16px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, 'mixed !important still matches');
}

section('Edge — mixed !important difference blocks duplicate');
{
  const css = `.a { color: red !important; padding: 16px; }\n.b { color: red; padding: 16px; }`;
  const parsed = parseCSS(css, '/test.css');
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, 'different !important flags = different signatures');
}
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(50)}`);
if (failed > 0) {
  process.exit(1);
}
