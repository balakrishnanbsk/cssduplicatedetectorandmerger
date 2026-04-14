// src/parser.ts
import * as cssTree from "css-tree";
function parseCSS(cssText, filePath) {
  const rules = [];
  extractRules(cssText, filePath, "", rules, 0, cssText);
  return { filePath, rules };
}
function extractRules(text, filePath, parentSelector, rules, baseOffset = 0, fullSource = text) {
  const baseLine = baseOffset > 0 ? fullSource.slice(0, baseOffset).split("\n").length - 1 : 0;
  try {
    const ast = cssTree.parse(text, {
      positions: true,
      filename: filePath,
      onParseError: () => {
      }
    });
    walkRules(ast, text, filePath, parentSelector, rules, baseOffset, baseLine, fullSource);
  } catch {
    extractRulesRegex(text, filePath, parentSelector, rules, baseOffset, baseLine, fullSource);
  }
}
function walkRules(node, sourceText, filePath, parentSelector, rules, baseOffset, baseLine, fullSource) {
  if (node.type === "StyleSheet" || node.type === "Block") {
    const children = node.children;
    if (children) {
      children.forEach((child) => {
        walkRules(child, sourceText, filePath, parentSelector, rules, baseOffset, baseLine, fullSource);
      });
    }
    return;
  }
  if (node.type === "Atrule") {
    if (node.block) {
      walkRules(node.block, sourceText, filePath, parentSelector, rules, baseOffset, baseLine, fullSource);
    }
    return;
  }
  if (node.type !== "Rule" || !node.prelude || node.prelude.type !== "SelectorList") {
    return;
  }
  const block = node.block;
  if (!block || block.type !== "Block") {
    return;
  }
  const properties = [];
  block.children.forEach((child) => {
    if (child.type === "Declaration") {
      properties.push({
        name: child.property,
        value: cssTree.generate(child.value).trim(),
        important: child.important === true,
        line: child.loc?.start.line ?? 0,
        column: child.loc?.start.column ?? 0
      });
    }
  });
  const localSelector = cssTree.generate(node.prelude);
  const fullSelector = parentSelector ? combineSelectors(parentSelector, localSelector) : localSelector;
  const startOffset = (node.loc?.start.offset ?? 0) + baseOffset;
  const endOffset = (node.loc?.end.offset ?? 0) + baseOffset;
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
      rawText
    });
  }
  block.children.forEach((child) => {
    if (child.type === "Rule") {
      walkRules(child, sourceText, filePath, fullSelector, rules, baseOffset, baseLine, fullSource);
    } else if (child.type === "Raw") {
      const rawOffset = (child.loc?.start.offset ?? 0) + baseOffset;
      extractRules(child.value, filePath, fullSelector, rules, rawOffset, fullSource);
    }
  });
}
function extractRulesRegex(text, filePath, parentSelector, rules, baseOffset, baseLine, fullSource) {
  const ruleRegex = /([^{}]+?)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRegex.exec(text)) !== null) {
    const selector = match[1].trim();
    const body = match[2].trim();
    if (!selector || !body) {
      continue;
    }
    const fullSelector = parentSelector ? combineSelectors(parentSelector, selector) : selector;
    const properties = [];
    const declRegex = /([\w-]+)\s*:\s*([^;]+?)(?:\s*(!important))?\s*;/g;
    let dm;
    while ((dm = declRegex.exec(body)) !== null) {
      const linesBefore = text.slice(0, match.index + match[0].indexOf(dm[0])).split("\n");
      properties.push({
        name: dm[1],
        value: dm[2].trim(),
        important: !!dm[3],
        line: linesBefore.length + baseLine,
        column: 1
      });
    }
    if (properties.length > 0) {
      const ruleStart = match.index + baseOffset;
      const ruleEnd = ruleStart + match[0].length;
      rules.push({
        selector: fullSelector,
        properties,
        filePath,
        line: text.slice(0, match.index).split("\n").length + baseLine,
        column: 1,
        startOffset: ruleStart,
        endOffset: ruleEnd,
        rawText: match[0]
      });
    }
  }
}
function combineSelectors(parent, child) {
  if (child.includes("&")) {
    return child.replace(/&/g, parent);
  }
  return parent + " " + child;
}
function normalizeValue(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function buildPropertySignature(properties) {
  return properties.map((p) => `${p.name.toLowerCase()}:${normalizeValue(p.value)}${p.important ? "!important" : ""}`).sort();
}
function shortenPath(filePath) {
  const parts = filePath.split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : filePath;
}

// src/scanner.ts
function scanForDuplicates(rules) {
  const sigMap = /* @__PURE__ */ new Map();
  for (const rule of rules) {
    if (rule.properties.length < 2) {
      continue;
    }
    const sig = buildPropertySignature(rule.properties);
    const key = sig.join("|");
    if (!sigMap.has(key)) {
      sigMap.set(key, []);
    }
    sigMap.get(key).push(rule);
  }
  const duplicates = [];
  for (const [, groupRules] of sigMap) {
    if (groupRules.length < 2) {
      continue;
    }
    const sig = buildPropertySignature(groupRules[0].properties);
    const display = groupRules[0].properties.map((p) => `${p.name}: ${p.value}${p.important ? " !important" : ""}`).join("; ");
    duplicates.push({
      signature: sig,
      displayKey: display,
      rules: groupRules
    });
  }
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
    totalRules
  };
}
function buildScanSummary(report) {
  const lines = [];
  lines.push("CSS Duplicate Rule Scan");
  lines.push("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  lines.push(`Duplicate groups: ${report.totalGroups}`);
  lines.push(`Total rules:      ${report.totalRules}`);
  lines.push("");
  for (const group of report.duplicates) {
    lines.push(`\u2500\u2500 { ${group.displayKey} } (${group.rules.length}\xD7) \u2500\u2500`);
    for (const rule of group.rules) {
      lines.push(`  \u2022 ${rule.selector}  (${shortenPath(rule.filePath)}:${rule.line})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// src/merger.ts
function mergeDuplicateGroup(group) {
  const rules = [...group.rules].sort((a, b) => a.startOffset - b.startOffset);
  const combinedSelector = rules.map((r) => r.selector).join(", ");
  const first = rules[0];
  const propsText = first.properties.map((p) => `  ${p.name}: ${p.value}${p.important ? " !important" : ""};`).join("\n");
  const sharedRule = `${combinedSelector} {
${propsText}
}`;
  const before = rules.map((r) => r.rawText.trim()).join("\n\n");
  const edits = [];
  edits.push({
    description: `Combine into "${combinedSelector}"`,
    filePath: first.filePath,
    originalText: first.rawText,
    replacementText: sharedRule,
    startOffset: first.startOffset,
    endOffset: first.endOffset
  });
  for (let i = 1; i < rules.length; i++) {
    edits.push({
      description: `Remove duplicate "${rules[i].selector}"`,
      filePath: rules[i].filePath,
      originalText: rules[i].rawText,
      replacementText: "",
      startOffset: rules[i].startOffset,
      endOffset: rules[i].endOffset
    });
  }
  return {
    edits,
    before,
    after: sharedRule,
    description: `Merge ${rules.length} selectors \u2192 ${combinedSelector} { ${group.displayKey} }`
  };
}
function applyEditsToSource(sourceText, edits) {
  const sorted = [...edits].sort((a, b) => b.startOffset - a.startOffset);
  let result = sourceText;
  for (const edit of sorted) {
    const before = result.slice(0, edit.startOffset);
    const after = result.slice(edit.endOffset);
    if (edit.replacementText === "") {
      const trailingWs = after.match(/^[\t ]*\r?\n(\r?\n)?/);
      const trimAfter = trailingWs ? after.slice(trailingWs[0].length) : after;
      result = before.replace(/\n\s*$/, "\n") + trimAfter;
    } else {
      result = before + edit.replacementText + after;
    }
  }
  return result;
}

// src/test.ts
var passed = 0;
var failed = 0;
function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 FAIL: ${msg}`);
  }
}
function assertEqual(actual, expected, msg) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 FAIL: ${msg}
    Expected: ${JSON.stringify(expected)}
    Actual:   ${JSON.stringify(actual)}`);
  }
}
function section(name) {
  console.log(`
\u25B8 ${name}`);
}
section("Parser \u2014 normalizeValue");
assertEqual(normalizeValue("  16px "), "16px", "trims whitespace");
assertEqual(normalizeValue("1px  2px   3px"), "1px 2px 3px", "collapses internal whitespace");
assertEqual(normalizeValue("RED"), "red", "lowercases");
assertEqual(normalizeValue("  Solid   1px  Black "), "solid 1px black", "combined normalize");
section("Parser \u2014 buildPropertySignature");
{
  const props = [
    { name: "color", value: "red", important: false, line: 1, column: 1 },
    { name: "padding", value: "16px", important: false, line: 2, column: 1 }
  ];
  const sig = buildPropertySignature(props);
  assertEqual(sig, ["color:red", "padding:16px"], "sorted property signature");
}
section("Parser \u2014 shortenPath");
assertEqual(shortenPath("/a/b/c/d.css"), ".../c/d.css", "shortens long path");
assertEqual(shortenPath("a/b.css"), "a/b.css", "keeps short path");
section("Parser \u2014 parseCSS");
{
  const css = `.card { padding: 16px; color: red; }
.box { padding: 16px; margin: 8px; }`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules.length, 2, "parses 2 rules");
  assertEqual(parsed.rules[0].selector, ".card", "first selector");
  assertEqual(parsed.rules[0].properties.length, 2, "first rule has 2 properties");
  assertEqual(parsed.rules[1].selector, ".box", "second selector");
}
section("Parser \u2014 handles empty input");
{
  const parsed = parseCSS("", "/empty.css");
  assertEqual(parsed.rules.length, 0, "empty input returns 0 rules");
}
section("Parser \u2014 !important");
{
  const css = `.a { padding: 16px !important; }`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules[0].properties[0].important, true, "detects !important");
}
section("Scanner \u2014 user example: exact duplicate rules");
{
  const css = `
    .card { padding: 16px; color: red; }
    .box { padding: 16px; margin: 8px; }
    .bard { padding: 16px; color: red; }
    .aard { color: red; padding: 16px; }
    .lard { padding: 16px !important; color: red; }
  `;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "1 duplicate group");
  assertEqual(report.duplicates[0].rules.length, 3, "3 rules in the group");
  const selectors = report.duplicates[0].rules.map((r) => r.selector).sort();
  assertEqual(selectors, [".aard", ".bard", ".card"], "correct selectors: .card, .bard, .aard");
}
section("Scanner \u2014 no duplicates when all property sets unique");
{
  const css = `.a { color: red; }
.b { color: blue; }
.c { margin: 10px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "0 duplicate groups");
}
section("Scanner \u2014 same properties different values are NOT duplicates");
{
  const css = `.a { padding: 16px; color: red; }
.b { padding: 16px; color: blue; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "different values \u2192 not duplicates");
}
section("Scanner \u2014 order-insensitive matching");
{
  const css = `.a { color: red; padding: 16px; }
.b { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "same properties different order \u2192 duplicate");
  assertEqual(report.duplicates[0].rules.length, 2, "2 rules");
}
section("Scanner \u2014 !important makes rule distinct");
{
  const css = `.a { padding: 16px; color: red; }
.b { padding: 16px !important; color: red; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "!important vs non-important \u2192 different signatures");
}
section("Scanner \u2014 matching !important rules ARE duplicates");
{
  const css = `.a { padding: 16px !important; color: red; }
.b { padding: 16px !important; color: red; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "both !important \u2192 duplicate");
}
section("Scanner \u2014 value normalization (case-insensitive)");
{
  const css = `.a { color: RED; margin: 0; }
.b { color: red; margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "RED and red normalized \u2192 duplicate");
}
section("Scanner \u2014 totalRules count");
{
  const css = `.a { padding: 16px; color: red; }
.b { padding: 16px; color: red; }
.c { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "1 group");
  assertEqual(report.totalRules, 3, "3 total rules");
}
section("Scanner \u2014 same selector twice is a duplicate");
{
  const css = `.card { color: red; padding: 10px; }
.card { color: red; padding: 10px; }`;
  const parsed = parseCSS(css, "/t.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "same selector same properties = duplicate");
}
section("Scanner \u2014 cross-file support");
{
  const css1 = `.card { padding: 16px; color: red; }`;
  const css2 = `.box { color: red; padding: 16px; }`;
  const rules = [
    ...parseCSS(css1, "/a.css").rules,
    ...parseCSS(css2, "/b.css").rules
  ];
  const report = scanForDuplicates(rules);
  assertEqual(report.totalGroups, 1, "cross-file duplicate detected");
  const files = report.duplicates[0].rules.map((r) => r.filePath);
  assert(files.includes("/a.css"), "has /a.css");
  assert(files.includes("/b.css"), "has /b.css");
}
section("Scanner \u2014 multiple duplicate groups");
{
  const css = `
    .a { padding: 16px; color: red; }
    .b { padding: 16px; color: red; }
    .c { margin: 8px; font-size: 14px; }
    .d { font-size: 14px; margin: 8px; }
  `;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 2, "2 duplicate groups");
}
section("Scanner \u2014 sorting: most rules first");
{
  const css = `
    .a { color: red; margin: 0; }
    .b { color: red; margin: 0; }
    .c { padding: 10px; font-size: 14px; }
    .d { padding: 10px; font-size: 14px; }
    .e { padding: 10px; font-size: 14px; }
  `;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.duplicates[0].rules.length, 3, "largest group first (3 rules)");
  assertEqual(report.duplicates[1].rules.length, 2, "smaller group second (2 rules)");
}
section("Scanner \u2014 extra property means NOT duplicate");
{
  const css = `.a { padding: 16px; color: red; }
.b { padding: 16px; color: red; margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "extra property makes it different");
}
section("Scanner \u2014 single rule, no duplicates");
{
  const css = `.only { color: red; padding: 10px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "single rule \u2192 no duplicates");
}
section("Merger \u2014 basic selector combination");
{
  const css = `.card { padding: 16px; color: red; }
.bard { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assert(merge.edits.length > 0, "generates edits");
  assert(merge.after.includes(".card, .bard"), "combined selector in output");
  assert(merge.after.includes("padding: 16px"), "properties preserved");
  assert(merge.after.includes("color: red"), "all properties preserved");
}
section("Merger \u2014 three selectors combined");
{
  const css = `
    .card { padding: 16px; color: red; }
    .bard { padding: 16px; color: red; }
    .aard { color: red; padding: 16px; }
  `;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const afterText = merge.after;
  assert(afterText.includes(".card"), "has .card");
  assert(afterText.includes(".bard"), "has .bard");
  assert(afterText.includes(".aard"), "has .aard");
  assert(afterText.includes("padding: 16px"), "has padding");
  assert(afterText.includes("color: red"), "has color");
}
section("Merger \u2014 removes duplicate rules after first");
{
  const css = `.a { padding: 16px; color: red; }
.b { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assertEqual(merge.edits.length, 2, "2 edits");
  assert(merge.edits[0].replacementText.includes(".a, .b"), "first edit is combined rule");
  assertEqual(merge.edits[1].replacementText, "", "second edit is deletion");
}
section("Merger \u2014 applyEditsToSource works");
{
  const css = `.card {
  padding: 16px;
  color: red;
}

.bard {
  padding: 16px;
  color: red;
}`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const result = applyEditsToSource(css, merge.edits);
  assert(result.includes(".card, .bard"), "combined selector in applied result");
  assert(result.includes("padding: 16px"), "properties in applied result");
  assert(result.includes("color: red"), "all properties in applied result");
  const ruleBlocks = result.split("}").filter((s) => s.trim().includes("{"));
  assertEqual(ruleBlocks.length, 1, "only 1 rule block remains after merge");
}
section("Merger \u2014 handles !important in merge");
{
  const css = `.a { padding: 16px !important; color: red; }
.b { padding: 16px !important; color: red; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assert(merge.after.includes("!important"), "preserves !important");
}
section("Edge \u2014 vendor prefixes");
{
  const css = `.a { -webkit-transform: rotate(45deg); opacity: 1; }
.b { -webkit-transform: rotate(45deg); opacity: 1; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "vendor-prefixed duplicate detected");
}
section("Edge \u2014 shorthand vs longhand are different rules");
{
  const css = `.a { margin: 10px; }
.b { margin-top: 10px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "different property names = different signatures");
}
section("Edge \u2014 many selectors with same rule");
{
  const selectors = Array.from({ length: 10 }, (_, i) => `.s${i} { display: flex; align-items: center; }`);
  const css = selectors.join("\n");
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "1 group");
  assertEqual(report.duplicates[0].rules.length, 10, "10 rules");
}
section("Edge \u2014 empty rules excluded");
{
  const css = `.empty { }`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules.length, 0, "empty rule is excluded");
}
section("Edge \u2014 media query different value not duplicate");
{
  const css = `.a { color: red; }
@media (max-width: 768px) { .a { color: blue; } }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "different values not duplicated");
}
section("Edge \u2014 subset of properties is NOT a duplicate");
{
  const css = `.a { padding: 16px; color: red; }
.b { padding: 16px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "subset is not a duplicate");
}
section("LESS \u2014 nested rules are extracted");
{
  const less = `.parent {
  .child { color: red; }
  .other { color: blue; }
}`;
  const parsed = parseCSS(less, "/test.less");
  assert(parsed.rules.length >= 2, "extracts nested rules (got " + parsed.rules.length + ")");
  const selectors = parsed.rules.map((r) => r.selector);
  assert(selectors.some((s) => s.includes("parent") && s.includes("child")), "has parent child selector");
  assert(selectors.some((s) => s.includes("parent") && s.includes("other")), "has parent other selector");
}
section("LESS \u2014 nested duplicate rules detected");
{
  const less = `.parent {
  .child { color: red; padding: 16px; }
  .other { color: red; padding: 16px; }
}`;
  const parsed = parseCSS(less, "/test.less");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "nested duplicate group detected");
  assertEqual(report.duplicates[0].rules.length, 2, "2 nested rules in group");
}
section("LESS \u2014 nested rules NOT duplicates of flat rules with different props");
{
  const less = `.parent {
  .child { color: red; }
}
.other { color: blue; }`;
  const parsed = parseCSS(less, "/test.less");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "different values \u2192 no duplicates");
}
section("LESS \u2014 & parent reference selector");
{
  const less = `.btn {
  &.active { color: red; padding: 5px; }
  &.disabled { color: red; padding: 5px; }
}`;
  const parsed = parseCSS(less, "/test.less");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "& selector duplicates detected");
  const sels = report.duplicates[0].rules.map((r) => r.selector).sort();
  assert(sels.some((s) => s.includes(".btn") && s.includes(".active")), "has .btn.active");
  assert(sels.some((s) => s.includes(".btn") && s.includes(".disabled")), "has .btn.disabled");
}
section("LESS \u2014 parent with own properties + nested children");
{
  const less = `.card {
  padding: 16px;
  .title { font-size: 18px; }
}`;
  const parsed = parseCSS(less, "/test.less");
  assert(parsed.rules.length >= 2, "parent and nested child both extracted");
  const cardRule = parsed.rules.find((r) => r.selector === ".card");
  assert(!!cardRule, ".card rule found");
  assert(cardRule.properties.some((p) => p.name === "padding"), ".card has padding prop");
}
section("LESS \u2014 deeply nested rules");
{
  const less = `.a {
  .b {
    .c { color: red; margin: 0; }
    .d { color: red; margin: 0; }
  }
}`;
  const parsed = parseCSS(less, "/test.less");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "deeply nested duplicates detected");
}
section("LESS \u2014 variables in values");
{
  const less = `@primary: red;
.card { color: @primary; padding: 16px; }
.box { color: @primary; padding: 16px; }`;
  const parsed = parseCSS(less, "/test.less");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "LESS variable values matched as duplicates");
}
section("LESS \u2014 flat rules (no nesting) still work");
{
  const less = `.card { padding: 16px; color: red; }
.box { padding: 16px; color: red; }`;
  const parsed = parseCSS(less, "/test.less");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "flat LESS rules detected");
  assertEqual(report.duplicates[0].rules.length, 2, "2 rules in group");
}
section("LESS \u2014 nested rule line numbers are absolute");
{
  const less = `.wrapper {
  color: blue;
  .child {
    color: red;
    padding: 16px;
  }
}
.other {
  color: red;
  padding: 16px;
}`;
  const parsed = parseCSS(less, "/test.less");
  const childRule = parsed.rules.find((r) => r.selector.includes("child"));
  assert(!!childRule, "found nested child rule");
  assert(childRule.line >= 3, "nested child line is absolute (>= 3), got " + childRule.line);
  const otherRule = parsed.rules.find((r) => r.selector === ".other");
  assert(!!otherRule, "found .other rule");
  assertEqual(otherRule.line, 8, ".other at absolute line 8");
}
section("SCSS \u2014 nested rules are extracted");
{
  const scss = `.parent {
  .child { color: red; margin: 0; }
  .other { color: red; margin: 0; }
}`;
  const parsed = parseCSS(scss, "/test.scss");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "SCSS nested duplicates detected");
}
section("Parser \u2014 CSS comments are ignored");
{
  const css = `/* This is a comment */
.a { color: red; padding: 5px; }
/* Another comment */
.b { color: red; padding: 5px; }`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules.length, 2, "parses 2 rules ignoring comments");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "duplicate detected through comments");
}
section("Parser \u2014 inline comments between properties");
{
  const css = `.a { color: red; /* inline */ padding: 16px; }
.b { padding: 16px; color: red; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "inline comments do not affect matching");
}
section("Parser \u2014 descendant selectors");
{
  const css = `.parent .child { color: red; margin: 0; }
.other .item { color: red; margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules.length, 2, "parses descendant selectors");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "descendant selector duplicates detected");
}
section("Parser \u2014 child combinator selector");
{
  const css = `.a > .b { display: flex; gap: 10px; }
.c > .d { display: flex; gap: 10px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "child combinator duplicates detected");
}
section("Parser \u2014 sibling combinators");
{
  const css = `.a + .b { margin: 0; padding: 0; }
.c ~ .d { margin: 0; padding: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "sibling combinator duplicates detected");
}
section("Parser \u2014 multi-selector rules");
{
  const css = `.a, .b { color: red; padding: 16px; }
.c { color: red; padding: 16px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "multi-selector rule forms duplicate with single");
}
section("Parser \u2014 pseudo-class selectors");
{
  const css = `.btn:hover { color: red; opacity: 0.8; }
.link:hover { color: red; opacity: 0.8; }`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules.length, 2, "parses pseudo-class selectors");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "pseudo-class duplicates detected");
}
section("Parser \u2014 pseudo-element selectors");
{
  const css = `.a::before { content: ""; display: block; }
.b::before { content: ""; display: block; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "pseudo-element duplicates detected");
}
section("Parser \u2014 attribute selectors");
{
  const css = `[data-active] { color: red; font-weight: bold; }
input[type="text"] { color: red; font-weight: bold; }`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules.length, 2, "parses attribute selectors");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "attribute selector duplicates detected");
}
section("Parser \u2014 ID selectors");
{
  const css = `#header { padding: 10px; color: white; }
#footer { padding: 10px; color: white; }`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules.length, 2, "parses ID selectors");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "ID selector duplicates detected");
}
section("Parser \u2014 universal selector");
{
  const css = `* { box-sizing: border-box; margin: 0; }
div { box-sizing: border-box; margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules.length, 2, "parses universal selector");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "universal + element selector duplicate");
}
section("Parser \u2014 @media: rules inside media queries parsed");
{
  const css = `@media (max-width: 768px) {
  .card { padding: 10px; color: red; }
  .box { padding: 10px; color: red; }
}`;
  const parsed = parseCSS(css, "/test.css");
  assert(parsed.rules.length >= 2, "parses rules inside @media");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "duplicates inside @media detected");
}
section("Parser \u2014 @media: same properties inside and outside media");
{
  const css = `.a { color: red; padding: 5px; }
@media print { .b { color: red; padding: 5px; } }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "cross-media duplicate detected");
}
section("Parser \u2014 @supports: rules inside @supports");
{
  const css = `@supports (display: grid) {
  .grid { display: grid; gap: 10px; }
  .layout { display: grid; gap: 10px; }
}`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "@supports duplicates detected");
}
section("Parser \u2014 @keyframes rules are NOT regular rules");
{
  const css = `@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slide {
  from { opacity: 0; }
  to { opacity: 1; }
}`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assert(true, "@keyframes does not crash parser");
}
section("Parser \u2014 CSS custom properties (variables)");
{
  const css = `:root { --primary: #333; --secondary: blue; }
.a { --primary: #333; --secondary: blue; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "custom property duplicates detected");
}
section("Parser \u2014 var() function values");
{
  const css = `.a { color: var(--primary); margin: 0; }
.b { color: var(--primary); margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "var() value duplicates detected");
}
section("Parser \u2014 calc() expressions");
{
  const css = `.a { width: calc(100% - 20px); display: block; }
.b { width: calc(100% - 20px); display: block; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "calc() duplicates detected");
}
section("Parser \u2014 calc() different expressions are NOT duplicates");
{
  const css = `.a { width: calc(100% - 20px); display: block; }
.b { width: calc(100% - 30px); display: block; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "different calc() \u2192 not duplicates");
}
section("Parser \u2014 rgba/hsla function values");
{
  const css = `.a { background: rgba(255, 0, 0, 0.5); display: block; }
.b { background: rgba(255, 0, 0, 0.5); display: block; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "rgba() duplicates detected");
}
section("Parser \u2014 comma-separated values (font-family)");
{
  const css = `.a { font-family: Arial, Helvetica, sans-serif; font-size: 14px; }
.b { font-family: Arial, Helvetica, sans-serif; font-size: 14px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "font-family duplicates detected");
}
section("Parser \u2014 multi-value shorthand (border)");
{
  const css = `.a { border: 1px solid #ccc; padding: 10px; }
.b { border: 1px solid #ccc; padding: 10px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "border shorthand duplicates detected");
}
section("Parser \u2014 transition shorthand");
{
  const css = `.a { transition: all 0.3s ease-in-out; opacity: 1; }
.b { transition: all 0.3s ease-in-out; opacity: 1; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "transition duplicates detected");
}
section("Parser \u2014 multiple backgrounds");
{
  const css = `.a { background: url(a.png) no-repeat, url(b.png) repeat; display: block; }
.b { background: url(a.png) no-repeat, url(b.png) repeat; display: block; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "multiple background duplicates detected");
}
section("Parser \u2014 different whitespace formatting, same properties");
{
  const css1 = `.a{color:red;padding:16px}`;
  const css2 = `.b {
  color:   red ;
  padding:  16px ;
}`;
  const rules = [
    ...parseCSS(css1, "/a.css").rules,
    ...parseCSS(css2, "/b.css").rules
  ];
  const report = scanForDuplicates(rules);
  assertEqual(report.totalGroups, 1, "whitespace variations still match");
}
section("Parser \u2014 tabs vs spaces formatting");
{
  const css = ".a {\n	color: red;\n	padding: 16px;\n}\n.b {\n  color: red;\n  padding: 16px;\n}";
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "tabs vs spaces do not affect matching");
}
section("Parser \u2014 malformed CSS does not crash");
{
  const css = `.a { color: ; }
.b { : red; }
.c { color red; }`;
  try {
    const parsed = parseCSS(css, "/bad.css");
    assert(true, "malformed CSS parsed without throwing");
  } catch {
    assert(false, "malformed CSS should not throw");
  }
}
section("Parser \u2014 only comments, no rules");
{
  const css = `/* comment only */
/* another */`;
  const parsed = parseCSS(css, "/test.css");
  assertEqual(parsed.rules.length, 0, "comments-only produces 0 rules");
}
section("Parser \u2014 rule with semicolon after last property");
{
  const css = `.a { color: red; margin: 0; }
.b { color: red; margin: 0 }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "trailing semicolon does not affect matching");
}
section("Parser \u2014 deeply nested @media inside @supports");
{
  const css = `@supports (display: flex) {
  @media (min-width: 768px) {
    .a { display: flex; gap: 10px; }
    .b { display: flex; gap: 10px; }
  }
}`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "deeply nested at-rules: duplicates found");
}
section("Parser \u2014 rule with repeated property names");
{
  const css = `.a { color: red; color: var(--c); }
.b { color: red; color: var(--c); }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "repeated properties matched as duplicates");
}
section("Parser \u2014 rule with many properties (10+)");
{
  const props = "margin:0;padding:0;color:red;background:#fff;font-size:14px;line-height:1.5;display:block;position:relative;width:100%;height:auto;border:none;outline:none";
  const css = `.a { ${props}; }
.b { ${props}; }`;
  const parsed = parseCSS(css, "/test.css");
  assert(parsed.rules[0].properties.length >= 10, "rule has 10+ properties");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "many-property duplicates detected");
}
section("normalizeValue \u2014 preserves URL casing in values");
{
  const v = normalizeValue('  URL("MyImage.PNG")  ');
  assertEqual(v, 'url("myimage.png")', "normalizes URL value");
}
section("normalizeValue \u2014 empty string");
{
  assertEqual(normalizeValue(""), "", "empty value normalized");
}
section("normalizeValue \u2014 only whitespace");
{
  assertEqual(normalizeValue("   "), "", "whitespace-only normalized to empty");
}
section("buildPropertySignature \u2014 empty properties array");
{
  assertEqual(buildPropertySignature([]), [], "empty properties \u2192 empty signature");
}
section("buildPropertySignature \u2014 important flag included in signature");
{
  const props = [
    { name: "color", value: "RED", important: true, line: 1, column: 1 }
  ];
  const sig = buildPropertySignature(props);
  assertEqual(sig, ["color:red!important"], "important appended to signature");
}
section("buildPropertySignature \u2014 deterministic sorting");
{
  const p1 = [
    { name: "z-index", value: "1", important: false, line: 1, column: 1 },
    { name: "color", value: "red", important: false, line: 2, column: 1 },
    { name: "margin", value: "0", important: false, line: 3, column: 1 }
  ];
  const p2 = [
    { name: "margin", value: "0", important: false, line: 1, column: 1 },
    { name: "z-index", value: "1", important: false, line: 2, column: 1 },
    { name: "color", value: "red", important: false, line: 3, column: 1 }
  ];
  assertEqual(buildPropertySignature(p1), buildPropertySignature(p2), "sorted signatures match regardless of input order");
}
section("shortenPath \u2014 root-level file");
{
  assertEqual(shortenPath("/file.css"), "/file.css", "root file not shortened");
}
section("shortenPath \u2014 very deep path");
{
  assertEqual(shortenPath("/a/b/c/d/e/f/g.css"), ".../f/g.css", "deep path shortened");
}
section("shortenPath \u2014 two segments");
{
  assertEqual(shortenPath("a/b.css"), "a/b.css", "two segment path kept");
}
section("Scanner \u2014 100 identical rules");
{
  const rules100 = Array.from({ length: 100 }, (_, i) => `.r${i} { display: flex; align-items: center; }`).join("\n");
  const parsed = parseCSS(rules100, "/stress.css");
  assertEqual(parsed.rules.length, 100, "parsed all 100 rules");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "1 massive duplicate group");
  assertEqual(report.duplicates[0].rules.length, 100, "100 rules in group");
}
section("Scanner \u2014 50 different groups of 2");
{
  const lines = [];
  for (let i = 0; i < 50; i++) {
    lines.push(`.a${i} { prop${i}: val${i}; extra${i}: x; }`);
    lines.push(`.b${i} { prop${i}: val${i}; extra${i}: x; }`);
  }
  const parsed = parseCSS(lines.join("\n"), "/stress.css");
  assertEqual(parsed.rules.length, 100, "parsed 100 rules");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 50, "50 duplicate groups");
}
section("Scanner \u2014 0 rules produces empty report");
{
  const report = scanForDuplicates([]);
  assertEqual(report.totalGroups, 0, "0 groups from empty input");
  assertEqual(report.totalRules, 0, "0 rules from empty input");
  assertEqual(report.duplicates.length, 0, "empty duplicates array");
}
section("Scanner \u2014 all rules unique (no false positives)");
{
  const lines = Array.from({ length: 20 }, (_, i) => `.unique${i} { prop${i}: value${i}; }`);
  const parsed = parseCSS(lines.join("\n"), "/test.css");
  assertEqual(parsed.rules.length, 20, "parsed 20 unique rules");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "0 duplicates from 20 unique rules");
}
section("Scanner \u2014 same selector different props NOT duplicate");
{
  const css = `.card { color: red; }
.card { padding: 16px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "same selector different props \u2192 no duplicate");
}
section("Scanner \u2014 property name case sensitivity");
{
  const css = `.a { Color: red; margin: 0; }
.b { color: red; margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "property name case insensitive");
}
section("Scanner \u2014 sorting stability: same count, alphabetical displayKey");
{
  const css = `
    .z1 { z-index: 1; opacity: 1; }
    .z2 { z-index: 1; opacity: 1; }
    .a1 { color: red; margin: 0; }
    .a2 { color: red; margin: 0; }
  `;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 2, "2 groups");
  assert(
    report.duplicates[0].displayKey <= report.duplicates[1].displayKey,
    "same-count groups sorted alphabetically"
  );
}
section("Scanner \u2014 3 files, duplicates span all of them");
{
  const rules = [
    ...parseCSS(".a { display: flex; gap: 10px; }", "/one.css").rules,
    ...parseCSS(".b { display: flex; gap: 10px; }", "/two.css").rules,
    ...parseCSS(".c { display: flex; gap: 10px; }", "/three.css").rules
  ];
  const report = scanForDuplicates(rules);
  assertEqual(report.totalGroups, 1, "cross-3-file duplicate");
  assertEqual(report.duplicates[0].rules.length, 3, "3 rules from 3 files");
  const files = new Set(report.duplicates[0].rules.map((r) => r.filePath));
  assertEqual(files.size, 3, "3 unique files");
}
section("Scanner \u2014 cross-file: only 2 of 3 files duplicate");
{
  const rules = [
    ...parseCSS(".a { color: red; padding: 10px; }", "/one.css").rules,
    ...parseCSS(".b { color: red; padding: 10px; }", "/two.css").rules,
    ...parseCSS(".c { color: blue; padding: 10px; }", "/three.css").rules
  ];
  const report = scanForDuplicates(rules);
  assertEqual(report.totalGroups, 1, "1 group from 2 matching files");
  assertEqual(report.duplicates[0].rules.length, 2, "2 rules in group");
}
section("buildScanSummary \u2014 includes group and rule counts");
{
  const css = `.a { color: red; margin: 0; }
.b { color: red; margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const summary = buildScanSummary(report);
  assert(summary.includes("Duplicate groups: 1"), "summary shows group count");
  assert(summary.includes("Total rules:      2"), "summary shows rule count");
  assert(summary.includes(".a"), "summary lists selector .a");
  assert(summary.includes(".b"), "summary lists selector .b");
}
section("buildScanSummary \u2014 empty report");
{
  const report = { duplicates: [], totalGroups: 0, totalRules: 0 };
  const summary = buildScanSummary(report);
  assert(summary.includes("Duplicate groups: 0"), "empty report summary");
}
section("Merger \u2014 5 selectors combined");
{
  const css = `.a { color: red; margin: 0; }
.b { color: red; margin: 0; }
.c { color: red; margin: 0; }
.d { color: red; margin: 0; }
.e { color: red; margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assert(merge.after.includes(".a, .b, .c, .d, .e"), "5 selectors combined");
  assertEqual(merge.edits.length, 5, "5 edits (1 replace + 4 delete)");
  assertEqual(merge.edits[0].replacementText.length > 0, true, "first edit is replacement");
  for (let i = 1; i < 5; i++) {
    assertEqual(merge.edits[i].replacementText, "", `edit ${i + 1} is deletion`);
  }
}
section("Merger \u2014 preserves property order from first rule");
{
  const css = `.first { z-index: 1; color: red; margin: 0; }
.second { color: red; margin: 0; z-index: 1; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const lines = merge.after.split("\n").map((l) => l.trim()).filter((l) => l && l !== "}");
  assert(lines[1].startsWith("z-index"), "first property preserved from first rule");
}
section("Merger \u2014 complex selectors in combined output");
{
  const css = `.nav > .item:hover { color: red; opacity: 0.8; }
.menu .link:active { color: red; opacity: 0.8; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assert(merge.after.includes(".nav") && merge.after.includes(".item:hover"), "complex selector 1 preserved");
  assert(merge.after.includes(".menu") && merge.after.includes(".link:active"), "complex selector 2 preserved");
}
section("Merger \u2014 merge description is informative");
{
  const css = `.foo { display: flex; gap: 10px; }
.bar { display: flex; gap: 10px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  assert(merge.description.includes("Merge"), 'description contains "Merge"');
  assert(merge.description.includes(".foo, .bar"), "description contains combined selectors");
}
section("Merger \u2014 applyEditsToSource: multiple rules with gaps");
{
  const css = `.a {
  color: red;
  margin: 0;
}

.unrelated {
  background: blue;
}

.b {
  color: red;
  margin: 0;
}`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const result = applyEditsToSource(css, merge.edits);
  assert(result.includes(".a, .b"), "combined selector in result");
  assert(result.includes(".unrelated"), "unrelated rule preserved");
  assert(result.includes("background: blue"), "unrelated properties preserved");
}
section("Merger \u2014 applyEditsToSource: adjacent rules no blank line");
{
  const css = `.a { color: red; margin: 0; }
.b { color: red; margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const result = applyEditsToSource(css, merge.edits);
  assert(result.includes(".a, .b"), "adjacent rules merged");
  const standaloneB = (result.match(/^\s*\.b\s*\{/gm) || []).length;
  assertEqual(standaloneB, 0, ".b standalone rule removed");
}
section("Merger \u2014 cross-file merge creates per-file edits");
{
  const rules = [
    ...parseCSS(".x { padding: 5px; margin: 0; }", "/file1.css").rules,
    ...parseCSS(".y { padding: 5px; margin: 0; }", "/file2.css").rules
  ];
  const report = scanForDuplicates(rules);
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const files = new Set(merge.edits.map((e) => e.filePath));
  assertEqual(files.size, 2, "edits span 2 files");
}
section("Integration \u2014 parse \u2192 scan \u2192 merge \u2192 apply \u2192 rescan = 0 duplicates");
{
  const css = `.card {
  padding: 16px;
  color: red;
}

.sidebar {
  background: blue;
}

.bard {
  color: red;
  padding: 16px;
}`;
  const parsed1 = parseCSS(css, "/test.css");
  const report1 = scanForDuplicates(parsed1.rules);
  assertEqual(report1.totalGroups, 1, "initial scan: 1 group");
  const merge = mergeDuplicateGroup(report1.duplicates[0]);
  const merged = applyEditsToSource(css, merge.edits);
  const parsed2 = parseCSS(merged, "/test.css");
  const report2 = scanForDuplicates(parsed2.rules);
  assertEqual(report2.totalGroups, 0, "after merge: 0 duplicates");
  assert(merged.includes(".card"), "merged still has .card");
  assert(merged.includes(".bard"), "merged still has .bard (in combined)");
  assert(merged.includes(".sidebar"), "unrelated .sidebar preserved");
}
section("Integration \u2014 multiple groups: merge one, others remain");
{
  const css = `.a { color: red; margin: 0; }
.b { color: red; margin: 0; }
.c { padding: 10px; font-size: 14px; }
.d { padding: 10px; font-size: 14px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 2, "2 groups initially");
  const merge = mergeDuplicateGroup(report.duplicates[0]);
  const merged = applyEditsToSource(css, merge.edits);
  const parsed2 = parseCSS(merged, "/test.css");
  const report2 = scanForDuplicates(parsed2.rules);
  assertEqual(report2.totalGroups, 1, "after merging 1 group: 1 remains");
}
section("Integration \u2014 merge all groups sequentially");
{
  const css = `.a { color: red; margin: 0; }
.b { color: red; margin: 0; }
.c { padding: 10px; font-size: 14px; }
.d { padding: 10px; font-size: 14px; }`;
  let source = css;
  let parsed = parseCSS(source, "/test.css");
  let report = scanForDuplicates(parsed.rules);
  while (report.totalGroups > 0) {
    const sameFile = report.duplicates.filter(
      (g) => g.rules.every((r) => r.filePath === g.rules[0].filePath)
    );
    if (sameFile.length === 0) {
      break;
    }
    const merge = mergeDuplicateGroup(sameFile[0]);
    source = applyEditsToSource(source, merge.edits);
    parsed = parseCSS(source, "/test.css");
    report = scanForDuplicates(parsed.rules);
  }
  assertEqual(report.totalGroups, 0, "all groups merged");
  assert(source.includes(".a"), "has .a");
  assert(source.includes(".b"), "has .b in combined selector");
  assert(source.includes(".c"), "has .c");
  assert(source.includes(".d"), "has .d in combined selector");
}
section("LESS \u2014 & with pseudo-class (:hover)");
{
  const less = `.btn {
  &:hover { color: red; opacity: 0.8; }
  &:focus { color: red; opacity: 0.8; }
}`;
  const parsed = parseCSS(less, "/test.less");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "&:hover and &:focus duplicates detected");
  const sels = report.duplicates[0].rules.map((r) => r.selector).sort();
  assert(sels.some((s) => s.includes(":hover")), "has :hover selector");
  assert(sels.some((s) => s.includes(":focus")), "has :focus selector");
}
section("LESS \u2014 & with pseudo-element (::before)");
{
  const less = `.icon {
  &::before { content: ""; display: block; }
  &::after { content: ""; display: block; }
}`;
  const parsed = parseCSS(less, "/test.less");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "&::before and &::after duplicates");
}
section("SCSS \u2014 mixed nested and flat rules");
{
  const scss = `.flat { color: red; margin: 0; }
.parent {
  .nested { color: red; margin: 0; }
}`;
  const parsed = parseCSS(scss, "/test.scss");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "flat and nested with same props = duplicate");
}
section("SCSS \u2014 3 levels deep nesting");
{
  const scss = `.a {
  .b {
    .c {
      color: red;
      padding: 10px;
    }
  }
}
.d {
  .e {
    .f {
      padding: 10px;
      color: red;
    }
  }
}`;
  const parsed = parseCSS(scss, "/test.scss");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "3-level nested duplicates detected");
}
section("SCSS \u2014 sibling nested blocks");
{
  const scss = `.card {
  .header { font-weight: bold; line-height: 1; }
  .footer { font-weight: bold; line-height: 1; }
  .body { color: red; margin: 0; }
}`;
  const parsed = parseCSS(scss, "/test.scss");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "sibling nested duplicates");
  assertEqual(report.duplicates[0].rules.length, 2, "2 sibling rules");
}
section("SCSS \u2014 parent with props does not interfere with child matching");
{
  const scss = `.card {
  padding: 20px;
  .title { color: red; margin: 0; }
}
.box {
  margin: 10px;
  .label { color: red; margin: 0; }
}`;
  const parsed = parseCSS(scss, "/test.scss");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "nested children matched independently of parent props");
}
section("LESS \u2014 multiple & references");
{
  const less = `.btn {
  &.primary & { color: white; font-weight: bold; }
  &.secondary & { color: white; font-weight: bold; }
}`;
  const parsed = parseCSS(less, "/test.less");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "multiple & references duplicates");
}
section("Real-world \u2014 reset/normalize duplicate detection");
{
  const css = `
    h1, h2, h3 { margin: 0; padding: 0; }
    p, span { margin: 0; padding: 0; }
  `;
  const parsed = parseCSS(css, "/reset.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "reset-style duplicates detected");
}
section("Real-world \u2014 utility classes with identical styles");
{
  const css = `
    .text-center { text-align: center; display: block; }
    .align-center { text-align: center; display: block; }
    .centered { text-align: center; display: block; }
    .flex-center { display: flex; justify-content: center; align-items: center; }
    .flex-middle { display: flex; justify-content: center; align-items: center; }
  `;
  const parsed = parseCSS(css, "/utilities.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 2, "2 groups of utility duplicates");
}
section("Real-world \u2014 component with BEM naming duplicates");
{
  const css = `
    .card__header { padding: 16px; border-bottom: 1px solid #eee; }
    .modal__header { padding: 16px; border-bottom: 1px solid #eee; }
    .panel__header { padding: 16px; border-bottom: 1px solid #eee; }
  `;
  const parsed = parseCSS(css, "/components.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "BEM duplicates detected");
  assertEqual(report.duplicates[0].rules.length, 3, "3 BEM rules in group");
}
section("Real-world \u2014 responsive duplicates across breakpoints");
{
  const css = `
    .container { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
    @media (max-width: 768px) {
      .wrapper { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
    }
  `;
  const parsed = parseCSS(css, "/layout.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "responsive duplicate detected cross-breakpoint");
}
section("Real-world \u2014 large file with no duplicates (no false positives)");
{
  const lines = [];
  for (let i = 0; i < 50; i++) {
    const propCount = i % 5 + 1;
    const props = Array.from({ length: propCount }, (_, j) => `prop${i}_${j}: val${i}_${j}`).join("; ");
    lines.push(`.unique-class-${i} { ${props}; }`);
  }
  const parsed = parseCSS(lines.join("\n"), "/large.css");
  assertEqual(parsed.rules.length, 50, "parsed 50 unique rules");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "large unique file: 0 false positives");
}
section("Real-world \u2014 mixed languages: CSS + SCSS features");
{
  const scss = `
    .card {
      border-radius: 4px;
      &:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.1); outline: none; }
      &:focus { box-shadow: 0 2px 4px rgba(0,0,0,0.1); outline: none; }
    }
  `;
  const parsed = parseCSS(scss, "/test.scss");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "SCSS hover/focus duplicates detected");
}
section("Edge \u2014 single property rule skipped (full duplicate requires 2+ properties)");
{
  const css = `.a { color: red; }
.b { color: red; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "single-property rules are not flagged");
}
section("Edge \u2014 extremely long selector");
{
  const longSel = ".parent .child .grandchild .great-grandchild .great-great-grandchild";
  const css = `${longSel} { color: red; margin: 0; }
.short { color: red; margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "long selector duplicate detected");
}
section("Edge \u2014 special characters in class names");
{
  const css = `.my-class_v2 { color: red; padding: 5px; }
.other-class_v2 { color: red; padding: 5px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "special chars in class names");
}
section("Edge \u2014 escaped characters in selectors");
{
  const css = `.col-1\\/2 { width: 50%; display: block; }
.half { width: 50%; display: block; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "escaped selector character duplicates");
}
section("Edge \u2014 negative values");
{
  const css = `.a { margin: -10px; z-index: -1; }
.b { z-index: -1; margin: -10px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "negative values duplicate detected");
}
section("Edge \u2014 zero values in different units are NOT normalized");
{
  const css = `.a { margin: 0px; }
.b { margin: 0; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assert(report.totalGroups <= 1, "zero values handled without crash");
}
section("Edge \u2014 !important on all properties");
{
  const css = `.a { color: red !important; padding: 16px !important; }
.b { padding: 16px !important; color: red !important; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "all !important properties duplicate");
}
section("Edge \u2014 mixed !important: some match, some dont");
{
  const css = `.a { color: red !important; padding: 16px; }
.b { color: red !important; padding: 16px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 1, "mixed !important still matches");
}
section("Edge \u2014 mixed !important difference blocks duplicate");
{
  const css = `.a { color: red !important; padding: 16px; }
.b { color: red; padding: 16px; }`;
  const parsed = parseCSS(css, "/test.css");
  const report = scanForDuplicates(parsed.rules);
  assertEqual(report.totalGroups, 0, "different !important flags = different signatures");
}
console.log(`
${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(50)}`);
if (failed > 0) {
  process.exit(1);
}
