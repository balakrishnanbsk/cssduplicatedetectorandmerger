"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode4 = __toESM(require("vscode"));
var path = __toESM(require("path"));

// src/parser.ts
var cssTree = __toESM(require("css-tree"));
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

// src/decorations.ts
var vscode = __toESM(require("vscode"));
var duplicateDecorationType;
function createDecorationTypes() {
  duplicateDecorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: void 0,
    // will use gutterIconSize with a colored dot
    overviewRulerColor: "#ffaa0066",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    isWholeLine: false,
    // Subtle left-border indicator instead of full background paint
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: "#ffaa0044"
  });
}
function applyDecorations(editor, report) {
  const decorations = [];
  const editorPath = editor.document.uri.fsPath;
  for (const group of report.duplicates) {
    const selectors = group.rules.map((r) => r.selector);
    const count = group.rules.length;
    for (const rule of group.rules) {
      if (!isMatchingFile(editorPath, rule.filePath)) {
        continue;
      }
      const line = Math.max(0, rule.line - 1);
      if (line >= editor.document.lineCount) {
        continue;
      }
      const lineText = editor.document.lineAt(line).text;
      const range = new vscode.Range(line, 0, line, lineText.length);
      decorations.push({
        range,
        hoverMessage: buildHover(group)
      });
    }
  }
  if (duplicateDecorationType) {
    editor.setDecorations(duplicateDecorationType, decorations);
  }
}
function clearDecorations(editor) {
  if (duplicateDecorationType) {
    editor.setDecorations(duplicateDecorationType, []);
  }
}
function createDiagnostics(document, report, severity) {
  const diagnostics = [];
  const docPath = document.uri.fsPath;
  for (const group of report.duplicates) {
    for (const rule of group.rules) {
      if (!isMatchingFile(docPath, rule.filePath)) {
        continue;
      }
      const line = Math.max(0, rule.line - 1);
      if (line >= document.lineCount) {
        continue;
      }
      const lineText = document.lineAt(line).text;
      const range = new vscode.Range(line, 0, line, lineText.length);
      const msg = buildDiagnosticMessage(rule, group);
      const diag = new vscode.Diagnostic(range, msg, severity);
      diag.source = "CSS Duplicate Detector";
      diag.code = "duplicate-rule";
      diagnostics.push(diag);
    }
  }
  return diagnostics;
}
function buildDiagnosticMessage(rule, group) {
  const others = group.rules.filter((r) => r !== rule);
  const propCount = group.signature.length;
  const propLabel = propCount === 1 ? "property" : "properties";
  const propNames = group.signature.map((s) => s.split(":")[0]);
  const MAX_PROPS = 2;
  let propSummary = propNames.slice(0, MAX_PROPS).join(", ");
  if (propNames.length > MAX_PROPS) {
    propSummary += ` +${propNames.length - MAX_PROPS}`;
  }
  const MAX_LINES = 5;
  const locations = others.slice(0, MAX_LINES).map((r) => {
    const isCrossFile = r.filePath !== rule.filePath;
    return isCrossFile ? `${shortenPath(r.filePath)}:${r.line}` : `${r.line}`;
  });
  let locText = locations.join(", ");
  if (others.length > MAX_LINES) {
    locText += ` +${others.length - MAX_LINES} more`;
  }
  return `${others.length + 1} duplicate rules share ${propCount} ${propLabel} {${propSummary}} \u2014 lines ${locText}`;
}
function buildHover(group) {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.appendMarkdown("### CSS Duplicate Detector\n\n");
  md.appendMarkdown(`**Duplicate rule** \u2014 ${group.rules.length} selectors share ${group.signature.length} identical properties

`);
  md.appendMarkdown(`Properties: \`${group.displayKey}\`

`);
  const MAX_HOVER = 10;
  const shown = group.rules.slice(0, MAX_HOVER);
  for (const rule of shown) {
    md.appendMarkdown(`- \`${rule.selector}\` \xB7 \`${shortenPath(rule.filePath)}:${rule.line}\`
`);
  }
  if (group.rules.length > MAX_HOVER) {
    md.appendMarkdown(`- ...and ${group.rules.length - MAX_HOVER} more
`);
  }
  return md;
}
function isMatchingFile(editorPath, rulePath) {
  const normEditor = editorPath.replace(/\\/g, "/").toLowerCase();
  const normRule = rulePath.replace(/\\/g, "/").toLowerCase();
  return normEditor.endsWith(normRule) || normRule.endsWith(normEditor) || normEditor === normRule;
}

// src/codeActions.ts
var vscode2 = __toESM(require("vscode"));

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

// src/codeActions.ts
var DuplicateMergeCodeActionProvider = class {
  static providedCodeActionKinds = [vscode2.CodeActionKind.QuickFix];
  report = null;
  setReport(report) {
    this.report = report;
  }
  provideCodeActions(document, range) {
    if (!this.report) {
      return [];
    }
    const actions = [];
    const cursorLine = range.start.line + 1;
    const docPath = document.uri.fsPath;
    for (const group of this.report.duplicates) {
      const match = group.rules.find(
        (r) => isMatchingFile2(docPath, r.filePath) && r.line === cursorLine
      );
      if (!match) {
        continue;
      }
      const sameFile = group.rules.every((r) => isMatchingFile2(docPath, r.filePath));
      if (!sameFile) {
        continue;
      }
      const selectors = group.rules.map((r) => r.selector).join(", ");
      const mergeLabel = `Merge duplicate rules \u2192 ${selectors}`;
      const mergeAction = new vscode2.CodeAction(mergeLabel, vscode2.CodeActionKind.QuickFix);
      mergeAction.command = {
        command: "cssDuplicateDetector.mergeGroup",
        title: mergeLabel,
        arguments: [group, document.uri]
      };
      mergeAction.isPreferred = true;
      actions.push(mergeAction);
      const dismissLabel = `Dismiss this duplicate suggestion`;
      const dismissAction = new vscode2.CodeAction(dismissLabel, vscode2.CodeActionKind.QuickFix);
      dismissAction.command = {
        command: "cssDuplicateDetector.dismissGroup",
        title: dismissLabel,
        arguments: [group]
      };
      dismissAction.isPreferred = false;
      actions.push(dismissAction);
    }
    return actions;
  }
};
async function executeMergeGroup(group, fileUri) {
  const document = await vscode2.workspace.openTextDocument(fileUri);
  if (!group.rules.every((r) => isMatchingFile2(document.uri.fsPath, r.filePath))) {
    vscode2.window.showWarningMessage("Cross-file merges are not supported yet.");
    return;
  }
  const mergeResult = mergeDuplicateGroup(group);
  const newText = applyEditsToSource(document.getText(), mergeResult.edits);
  const accepted = await showDiffPreview(document, newText, mergeResult.description);
  if (accepted) {
    await applyMerge(document, newText);
  }
}
async function executeMergeAll(report, fileUri) {
  const document = await vscode2.workspace.openTextDocument(fileUri);
  const docPath = document.uri.fsPath;
  const sameFileGroups = report.duplicates.filter(
    (g) => g.rules.every((r) => isMatchingFile2(docPath, r.filePath))
  );
  if (sameFileGroups.length === 0) {
    vscode2.window.showInformationMessage("No duplicate rules to merge in this file.");
    return;
  }
  const allEdits = sameFileGroups.flatMap((g) => mergeDuplicateGroup(g).edits);
  const newText = applyEditsToSource(document.getText(), allEdits);
  const desc = `Merge ${sameFileGroups.length} duplicate rule group(s)`;
  const accepted = await showDiffPreview(document, newText, desc);
  if (accepted) {
    await applyMerge(document, newText);
  }
}
async function showDiffPreview(document, newText, title) {
  const beforeUri = vscode2.Uri.parse(`css-dup-before:${document.uri.fsPath}`);
  const afterUri = vscode2.Uri.parse(`css-dup-after:${document.uri.fsPath}`);
  const beforeProvider = new class {
    provideTextDocumentContent() {
      return document.getText();
    }
  }();
  const afterProvider = new class {
    provideTextDocumentContent() {
      return newText;
    }
  }();
  const disposables = [
    vscode2.workspace.registerTextDocumentContentProvider("css-dup-before", beforeProvider),
    vscode2.workspace.registerTextDocumentContentProvider("css-dup-after", afterProvider)
  ];
  try {
    await vscode2.commands.executeCommand("vscode.diff", beforeUri, afterUri, `CSS Merge Preview: ${title}`);
    const choice = await vscode2.window.showInformationMessage(
      `Apply merge: ${title}?`,
      { modal: false },
      "Apply",
      "Cancel"
    );
    return choice === "Apply";
  } finally {
    disposables.forEach((d) => d.dispose());
  }
}
async function applyMerge(document, newText) {
  const edit = new vscode2.WorkspaceEdit();
  const fullRange = new vscode2.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
  edit.replace(document.uri, fullRange, newText);
  await vscode2.workspace.applyEdit(edit);
  await document.save();
  vscode2.window.showInformationMessage("CSS Duplicate Detector: Merge applied.");
}
function isMatchingFile2(editorPath, rulePath) {
  const normEditor = editorPath.replace(/\\/g, "/").toLowerCase();
  const normRule = rulePath.replace(/\\/g, "/").toLowerCase();
  return normEditor.endsWith(normRule) || normRule.endsWith(normEditor) || normEditor === normRule;
}

// src/resultsPanel.ts
var vscode3 = __toESM(require("vscode"));
var currentPanel;
function showResultsPanel(context, report) {
  if (currentPanel) {
    currentPanel.webview.html = buildHtml(report);
    currentPanel.reveal(vscode3.ViewColumn.Beside);
    return;
  }
  currentPanel = vscode3.window.createWebviewPanel(
    "cssDuplicateResults",
    "CSS Duplicate Rules",
    vscode3.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  currentPanel.webview.html = buildHtml(report);
  currentPanel.webview.onDidReceiveMessage(
    async (msg) => {
      if (msg.command === "openFile") {
        const uri = vscode3.Uri.file(msg.filePath);
        const doc = await vscode3.workspace.openTextDocument(uri);
        const editor = await vscode3.window.showTextDocument(doc, vscode3.ViewColumn.One);
        const line = Math.max(0, (msg.line ?? 1) - 1);
        const pos = new vscode3.Position(line, 0);
        editor.selection = new vscode3.Selection(pos, pos);
        editor.revealRange(new vscode3.Range(pos, pos), vscode3.TextEditorRevealType.InCenter);
      } else if (msg.command === "dismiss") {
        const group = report.duplicates[msg.index];
        if (group) {
          await vscode3.commands.executeCommand("cssDuplicateDetector.dismissGroup", group);
          report.duplicates.splice(msg.index, 1);
          report.totalGroups = report.duplicates.length;
          report.totalRules = report.duplicates.reduce((s, g) => s + g.rules.length, 0);
          currentPanel.webview.html = buildHtml(report);
        }
      } else if (msg.command === "merge") {
        const group = report.duplicates[msg.index];
        if (group) {
          const fileUri = vscode3.Uri.file(group.rules[0].filePath);
          await vscode3.commands.executeCommand("cssDuplicateDetector.mergeGroup", group, fileUri);
        }
      } else if (msg.command === "mergeAll") {
        await vscode3.commands.executeCommand("cssDuplicateDetector.mergeAll");
      } else if (msg.command === "diffRule") {
        const group = report.duplicates[msg.groupIndex];
        const rule = group?.rules[msg.ruleIndex];
        if (rule) {
          await showRuleDiffPreview(rule);
        }
      } else if (msg.command === "deleteRule") {
        const group = report.duplicates[msg.groupIndex];
        const rule = group?.rules[msg.ruleIndex];
        if (rule) {
          const applied = await deleteRuleWithPreview(rule);
          if (applied) {
            group.rules.splice(msg.ruleIndex, 1);
            if (group.rules.length < 2) {
              report.duplicates.splice(msg.groupIndex, 1);
            }
            report.totalGroups = report.duplicates.length;
            report.totalRules = report.duplicates.reduce((s, g) => s + g.rules.length, 0);
            currentPanel.webview.html = buildHtml(report);
          }
        }
      }
    },
    void 0,
    context.subscriptions
  );
  currentPanel.onDidDispose(() => {
    currentPanel = void 0;
  });
}
async function showRuleDiffPreview(rule) {
  const doc = await vscode3.workspace.openTextDocument(vscode3.Uri.file(rule.filePath));
  const original = doc.getText();
  const edit = {
    description: `Remove "${rule.selector}"`,
    filePath: rule.filePath,
    originalText: rule.rawText,
    replacementText: "",
    startOffset: rule.startOffset,
    endOffset: rule.endOffset
  };
  const newText = applyEditsToSource(original, [edit]);
  const beforeUri = vscode3.Uri.parse(`css-dup-before:${doc.uri.fsPath}`);
  const afterUri = vscode3.Uri.parse(`css-dup-after:${doc.uri.fsPath}`);
  const beforeProvider = new class {
    provideTextDocumentContent() {
      return original;
    }
  }();
  const afterProvider = new class {
    provideTextDocumentContent() {
      return newText;
    }
  }();
  const disposables = [
    vscode3.workspace.registerTextDocumentContentProvider("css-dup-before", beforeProvider),
    vscode3.workspace.registerTextDocumentContentProvider("css-dup-after", afterProvider)
  ];
  await vscode3.commands.executeCommand(
    "vscode.diff",
    beforeUri,
    afterUri,
    `Diff: Remove "${rule.selector}" \u2014 ${shortenPath(rule.filePath)}:${rule.line}`
  );
  setTimeout(() => disposables.forEach((d) => d.dispose()), 3e4);
}
async function deleteRuleWithPreview(rule) {
  const doc = await vscode3.workspace.openTextDocument(vscode3.Uri.file(rule.filePath));
  const original = doc.getText();
  const edit = {
    description: `Remove "${rule.selector}"`,
    filePath: rule.filePath,
    originalText: rule.rawText,
    replacementText: "",
    startOffset: rule.startOffset,
    endOffset: rule.endOffset
  };
  const newText = applyEditsToSource(original, [edit]);
  const beforeUri = vscode3.Uri.parse(`css-dup-before:${doc.uri.fsPath}`);
  const afterUri = vscode3.Uri.parse(`css-dup-after:${doc.uri.fsPath}`);
  const beforeProvider = new class {
    provideTextDocumentContent() {
      return original;
    }
  }();
  const afterProvider = new class {
    provideTextDocumentContent() {
      return newText;
    }
  }();
  const disposables = [
    vscode3.workspace.registerTextDocumentContentProvider("css-dup-before", beforeProvider),
    vscode3.workspace.registerTextDocumentContentProvider("css-dup-after", afterProvider)
  ];
  try {
    await vscode3.commands.executeCommand(
      "vscode.diff",
      beforeUri,
      afterUri,
      `Delete: "${rule.selector}" \u2014 ${shortenPath(rule.filePath)}:${rule.line}`
    );
    const choice = await vscode3.window.showInformationMessage(
      `Delete rule "${rule.selector}" from ${shortenPath(rule.filePath)}:${rule.line}?`,
      { modal: false },
      "Delete",
      "Cancel"
    );
    if (choice === "Delete") {
      const wsEdit = new vscode3.WorkspaceEdit();
      const fullRange = new vscode3.Range(doc.positionAt(0), doc.positionAt(original.length));
      wsEdit.replace(doc.uri, fullRange, newText);
      await vscode3.workspace.applyEdit(wsEdit);
      await doc.save();
      return true;
    }
  } finally {
    disposables.forEach((d) => d.dispose());
  }
  return false;
}
function buildHtml(report) {
  const groupCards = report.duplicates.map((g, i) => buildGroupCard(g, i)).join("\n");
  const empty = report.duplicates.length === 0 ? `<div class="empty">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="2"/>
          <path d="M16 28c2 4 8 6 12 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="18" cy="20" r="2" fill="currentColor"/>
          <circle cx="30" cy="20" r="2" fill="currentColor"/>
        </svg>
        <p>No duplicate rules found!</p>
      </div>` : "";
  return (
    /* html */
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px; margin: 0;
  }
  h1 { font-size: 1.4em; margin: 0 0 4px 0; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
  .summary-bar {
    display: flex; gap: 24px;
    padding: 12px 16px;
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-radius: 6px; margin-bottom: 20px;
  }
  .stat-value { font-size: 1.5em; font-weight: bold; }
  .stat-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); }

  .group-card {
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 8px; margin-bottom: 14px; overflow: hidden;
  }
  .group-header {
    padding: 10px 14px;
    background: var(--vscode-editor-inactiveSelectionBackground);
    cursor: pointer; user-select: none;
  }
  .group-header:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .group-header-top {
    display: flex; justify-content: space-between; align-items: center;
  }
  .chevron {
    display: inline-block; margin-right: 6px;
    transition: transform 0.2s;
  }
  .group-card.collapsed .chevron {
    transform: rotate(-90deg);
  }
  .group-body {
    overflow: hidden;
  }
  .group-card.collapsed .group-body {
    display: none;
  }
  .group-title {
    font-weight: bold; font-size: 1em;
  }
  .count-badge {
    background: #ffaa00; color: #000;
    padding: 2px 8px; border-radius: 10px;
    font-size: 0.85em; font-weight: 600;
  }
  .props-list {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.9em; margin-top: 6px;
    color: var(--vscode-descriptionForeground);
  }

  .location {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 14px;
    border-bottom: 1px solid var(--vscode-panel-border, #222);
    transition: background 0.15s;
  }
  .location:hover { background: var(--vscode-list-hoverBackground); }
  .location:last-child { border-bottom: none; }
  .loc-info {
    flex: 1; cursor: pointer; min-width: 0;
  }
  .loc-selector {
    font-family: var(--vscode-editor-font-family, monospace);
    font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .loc-file {
    font-size: 0.8em; color: var(--vscode-textLink-foreground);
    word-break: break-all;
  }
  .loc-actions {
    display: flex; gap: 4px; flex-shrink: 0;
  }
  .loc-diff-btn {
    background: none; border: 1px solid var(--vscode-panel-border, #555);
    color: var(--vscode-textLink-foreground); padding: 2px 8px;
    border-radius: 3px; cursor: pointer; font-size: 0.78em;
    transition: background 0.15s, color 0.15s;
  }
  .loc-diff-btn:hover {
    background: var(--vscode-list-hoverBackground);
    color: var(--vscode-foreground);
  }
  .loc-del-btn {
    background: none; border: 1px solid var(--vscode-panel-border, #555);
    color: var(--vscode-errorForeground, #f44); padding: 2px 8px;
    border-radius: 3px; cursor: pointer; font-size: 0.78em;
    transition: background 0.15s;
  }
  .loc-del-btn:hover {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
  }

  .merge-preview {
    padding: 10px 14px;
    border-top: 1px solid var(--vscode-panel-border, #333);
    background: var(--vscode-diffEditor-insertedTextBackground, #2ea04322);
  }
  .merge-label { font-size: 0.78em; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  .merge-code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em; white-space: pre-wrap; word-break: break-all;
  }

  .empty { text-align: center; padding: 40px 20px; color: var(--vscode-descriptionForeground); }
  .empty svg { margin-bottom: 12px; }

  .dismiss-btn {
    background: none; border: 1px solid var(--vscode-panel-border, #555);
    color: var(--vscode-descriptionForeground); padding: 4px 12px;
    border-radius: 4px; cursor: pointer; font-size: 0.82em;
    transition: background 0.15s, color 0.15s;
  }
  .dismiss-btn:hover {
    background: var(--vscode-list-hoverBackground);
    color: var(--vscode-foreground);
  }
  .merge-btn {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none; padding: 5px 14px;
    border-radius: 4px; cursor: pointer; font-size: 0.85em;
    font-weight: 600;
    transition: background 0.15s;
  }
  .merge-btn:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }
  .merge-all-btn {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none; padding: 6px 16px;
    border-radius: 4px; cursor: pointer; font-size: 0.9em;
    font-weight: 600; margin-left: auto;
    transition: background 0.15s;
  }
  .merge-all-btn:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }
  .card-actions {
    display: flex; gap: 8px; align-items: center;
    padding: 8px 14px;
    border-top: 1px solid var(--vscode-panel-border, #333);
    background: var(--vscode-editor-inactiveSelectionBackground);
  }
  .cross-file-note {
    font-size: 0.82em; color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  .toggle-all-btn {
    background: none; border: 1px solid var(--vscode-panel-border, #555);
    color: var(--vscode-foreground); padding: 5px 12px;
    border-radius: 4px; cursor: pointer; font-size: 0.82em;
    transition: background 0.15s;
  }
  .toggle-all-btn:hover {
    background: var(--vscode-list-hoverBackground);
  }
</style>
</head>
<body>
  <h1>\u26A1 Duplicate CSS Rules</h1>
  <div class="subtitle">${report.totalGroups} duplicate group${report.totalGroups !== 1 ? "s" : ""} \xB7 ${report.totalRules} rules</div>

  <div class="summary-bar">
    <div>
      <div class="stat-value">${report.totalGroups}</div>
      <div class="stat-label">Duplicate Groups</div>
    </div>
    <div>
      <div class="stat-value">${report.totalRules}</div>
      <div class="stat-label">Total Rules</div>
    </div>
    ${report.totalGroups > 0 ? `
      <button class="toggle-all-btn" id="expandAllBtn">Expand All</button>
      <button class="toggle-all-btn" id="collapseAllBtn">Collapse All</button>
      <button class="merge-all-btn" id="mergeAllBtn">Merge All with Diff</button>
    ` : ""}
  </div>

  ${empty}
  ${groupCards}

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.loc-info').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({
          command: 'openFile',
          filePath: el.getAttribute('data-file'),
          line: parseInt(el.getAttribute('data-line') || '1', 10)
        });
      });
    });
    document.querySelectorAll('.loc-diff-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({
          command: 'diffRule',
          groupIndex: parseInt(el.getAttribute('data-group') || '0', 10),
          ruleIndex: parseInt(el.getAttribute('data-rule') || '0', 10)
        });
      });
    });
    document.querySelectorAll('.loc-del-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({
          command: 'deleteRule',
          groupIndex: parseInt(el.getAttribute('data-group') || '0', 10),
          ruleIndex: parseInt(el.getAttribute('data-rule') || '0', 10)
        });
      });
    });
    document.querySelectorAll('.dismiss-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({
          command: 'dismiss',
          index: parseInt(el.getAttribute('data-index') || '0', 10)
        });
      });
    });
    document.querySelectorAll('.merge-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({
          command: 'merge',
          index: parseInt(el.getAttribute('data-index') || '0', 10)
        });
      });
    });
    document.querySelectorAll('.group-header').forEach(el => {
      el.addEventListener('click', () => {
        el.closest('.group-card').classList.toggle('collapsed');
      });
    });
    const expandAllBtn = document.getElementById('expandAllBtn');
    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', () => {
        document.querySelectorAll('.group-card').forEach(c => c.classList.remove('collapsed'));
      });
    }
    const collapseAllBtn = document.getElementById('collapseAllBtn');
    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', () => {
        document.querySelectorAll('.group-card').forEach(c => c.classList.add('collapsed'));
      });
    }
    const mergeAllBtn = document.getElementById('mergeAllBtn');
    if (mergeAllBtn) {
      mergeAllBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'mergeAll' });
      });
    }
  </script>
</body>
</html>`
  );
}
function buildGroupCard(group, index) {
  const locationsHtml = group.rules.map((rule, ruleIdx) => (
    /* html */
    `
    <div class="location">
      <div class="loc-info" data-file="${esc(rule.filePath)}" data-line="${rule.line}">
        <div class="loc-selector">${esc(rule.selector)}</div>
        <div class="loc-file">${esc(shortenPath(rule.filePath))}:${rule.line}</div>
      </div>
      <div class="loc-actions">
        <button class="loc-diff-btn" data-group="${index}" data-rule="${ruleIdx}" title="Show diff preview">Diff</button>
        <button class="loc-del-btn" data-group="${index}" data-rule="${ruleIdx}" title="Delete this rule">Delete</button>
      </div>
    </div>
  `
  )).join("\n");
  const combinedSel = group.rules.map((r) => r.selector).join(", ");
  const propsText = group.rules[0].properties.map((p) => `  ${p.name}: ${p.value}${p.important ? " !important" : ""};`).join("\n");
  const mergePreview = `${combinedSel} {
${propsText}
}`;
  const files = new Set(group.rules.map((r) => r.filePath));
  const isSameFile = files.size === 1;
  const mergeBtn = isSameFile ? `<button class="merge-btn" data-index="${index}">Merge with Diff</button>` : `<span class="cross-file-note">Cross-file \u2014 merge manually</span>`;
  return (
    /* html */
    `
  <div class="group-card collapsed">
    <div class="group-header">
      <div class="group-header-top">
        <span class="chevron">\u25BC</span>
        <span class="group-title">Identical property set</span>
        <span class="count-badge">${group.rules.length} selectors</span>
      </div>
      <div class="props-list">${esc(group.displayKey)}</div>
    </div>
    <div class="group-body">
      ${locationsHtml}
      <div class="merge-preview">
        <div class="merge-label">\u2192 After merge</div>
        <div class="merge-code">${esc(mergePreview)}</div>
      </div>
      <div class="card-actions">
        ${mergeBtn}
        <button class="dismiss-btn" data-index="${index}">Dismiss</button>
      </div>
    </div>
  </div>`
  );
}
function esc(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// src/extension.ts
var diagnosticCollection;
var codeActionProvider;
var statusBarItem;
var lastReport = null;
var dismissedSignatures = /* @__PURE__ */ new Set();
function isExcludedFile(filePath) {
  const config = vscode4.workspace.getConfiguration("cssDuplicateDetector");
  const excludeExts = config.get("excludeExtensions", []);
  const excludeFiles = config.get("excludeFiles", []);
  const basename2 = path.basename(filePath);
  const lower = filePath.toLowerCase();
  for (const ext of excludeExts) {
    const e = ext.startsWith(".") ? ext : "." + ext;
    if (lower.endsWith(e.toLowerCase())) {
      return true;
    }
  }
  for (const pattern of excludeFiles) {
    if (basename2 === pattern) {
      return true;
    }
    const stripped = pattern.replace(/^\*\*\//, "").replace(/\/\*\*$/, "");
    if (stripped !== pattern && filePath.includes(path.sep + stripped + path.sep)) {
      return true;
    }
    if (stripped !== pattern && filePath.includes("/" + stripped + "/")) {
      return true;
    }
  }
  return false;
}
function buildExcludeGlob() {
  const config = vscode4.workspace.getConfiguration("cssDuplicateDetector");
  const excludeExts = config.get("excludeExtensions", []);
  const excludeFiles = config.get("excludeFiles", []);
  const parts = ["**/node_modules/**"];
  for (const ext of excludeExts) {
    const e = ext.startsWith(".") ? ext : "." + ext;
    parts.push("**/*" + e);
  }
  for (const pattern of excludeFiles) {
    parts.push(pattern);
  }
  return "{" + parts.join(",") + "}";
}
function activate(context) {
  diagnosticCollection = vscode4.languages.createDiagnosticCollection("cssDuplicateDetector");
  context.subscriptions.push(diagnosticCollection);
  createDecorationTypes();
  statusBarItem = vscode4.window.createStatusBarItem(vscode4.StatusBarAlignment.Right, 100);
  statusBarItem.command = "cssDuplicateDetector.showResults";
  statusBarItem.tooltip = "CSS Duplicate Detector \u2014 click to view results";
  context.subscriptions.push(statusBarItem);
  codeActionProvider = new DuplicateMergeCodeActionProvider();
  context.subscriptions.push(
    vscode4.languages.registerCodeActionsProvider(
      [{ language: "css" }, { language: "scss" }, { language: "less" }],
      codeActionProvider,
      { providedCodeActionKinds: DuplicateMergeCodeActionProvider.providedCodeActionKinds }
    )
  );
  context.subscriptions.push(
    vscode4.commands.registerCommand("cssDuplicateDetector.scan", () => scanCurrentFile(context)),
    vscode4.commands.registerCommand("cssDuplicateDetector.scanWorkspace", () => scanWorkspace(context)),
    vscode4.commands.registerCommand("cssDuplicateDetector.scanFolder", (uri) => scanFolder(context, uri)),
    vscode4.commands.registerCommand("cssDuplicateDetector.mergeAll", () => mergeAllInCurrentFile()),
    vscode4.commands.registerCommand("cssDuplicateDetector.mergeGroup", (group, uri) => executeMergeGroup(group, uri)),
    vscode4.commands.registerCommand("cssDuplicateDetector.dismissGroup", (group) => dismissGroup(context, group)),
    vscode4.commands.registerCommand("cssDuplicateDetector.dismissAll", () => dismissAll(context)),
    vscode4.commands.registerCommand("cssDuplicateDetector.showResults", async () => {
      if (!lastReport || lastReport.totalGroups === 0) {
        vscode4.window.showInformationMessage("No duplicate rules found. Run a scan first.");
        return;
      }
      const pick = await vscode4.window.showQuickPick(
        [
          { label: "$(list-unordered) Show Results", description: `${lastReport.totalGroups} duplicate groups`, id: "show" },
          { label: "$(merge) Merge All", description: "Merge all duplicates in current file", id: "merge" },
          { label: "$(close) Dismiss All", description: "Dismiss all current suggestions", id: "dismiss" },
          { label: "$(eye-closed) Hide Status Bar", description: "Hide until next scan", id: "hide" }
        ],
        { placeHolder: "CSS Duplicate Detector" }
      );
      if (!pick) {
        return;
      }
      switch (pick.id) {
        case "show":
          showResultsPanel(context, lastReport);
          break;
        case "merge":
          vscode4.commands.executeCommand("cssDuplicateDetector.mergeAll");
          break;
        case "dismiss":
          vscode4.commands.executeCommand("cssDuplicateDetector.dismissAll");
          break;
        case "hide":
          statusBarItem.hide();
          break;
      }
    }),
    vscode4.commands.registerCommand("cssDuplicateDetector.clearDiagnostics", () => {
      diagnosticCollection.clear();
      dismissedSignatures.clear();
      lastReport = null;
      const editor = vscode4.window.activeTextEditor;
      if (editor) {
        clearDecorations(editor);
      }
      updateStatusBar(0);
      vscode4.window.showInformationMessage("CSS Duplicate Detector: Diagnostics cleared.");
    })
  );
  context.subscriptions.push(
    vscode4.workspace.onDidSaveTextDocument((doc) => {
      if (isSupportedFile(doc)) {
        scanDocument(context, doc);
      }
    }),
    vscode4.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isSupportedFile(editor.document)) {
        scanDocument(context, editor.document);
      }
    })
  );
  if (vscode4.window.activeTextEditor) {
    const doc = vscode4.window.activeTextEditor.document;
    if (isSupportedFile(doc)) {
      scanDocument(context, doc);
    }
  }
}
function deactivate() {
  diagnosticCollection?.dispose();
  statusBarItem?.dispose();
}
function isSupportedFile(doc) {
  return ["css", "scss", "less"].includes(doc.languageId) && !isExcludedFile(doc.uri.fsPath);
}
async function scanCurrentFile(context) {
  const editor = vscode4.window.activeTextEditor;
  if (!editor) {
    vscode4.window.showWarningMessage("No active editor to scan.");
    return;
  }
  await scanDocument(context, editor.document);
  if (lastReport && lastReport.totalGroups > 0) {
    showResultsPanel(context, lastReport);
  }
}
async function scanDocument(context, document) {
  const parsed = parseCSS(document.getText(), document.uri.fsPath);
  const report = scanForDuplicates(parsed.rules);
  filterDismissed(report);
  lastReport = report;
  codeActionProvider.setReport(report);
  const config = vscode4.workspace.getConfiguration("cssDuplicateDetector");
  const severityLevel = config.get("severityLevel", "hint");
  if (severityLevel === "none") {
    diagnosticCollection.delete(document.uri);
  } else {
    const severity = parseSeverity(severityLevel);
    const diags = createDiagnostics(document, report, severity);
    diagnosticCollection.set(document.uri, diags);
  }
  const editor = vscode4.window.activeTextEditor;
  if (editor && editor.document.uri.fsPath === document.uri.fsPath) {
    if (config.get("enableInlineHints", false)) {
      applyDecorations(editor, report);
    } else {
      clearDecorations(editor);
    }
  }
  updateStatusBar(report.totalGroups);
}
async function scanWorkspace(context) {
  await vscode4.window.withProgress(
    {
      location: vscode4.ProgressLocation.Notification,
      title: "CSS Duplicate Detector: Scanning workspace...",
      cancellable: true
    },
    async (progress, token) => {
      diagnosticCollection.clear();
      progress.report({ message: "Finding style files..." });
      const styleFiles = await vscode4.workspace.findFiles("**/*.{css,scss,sass,less}", buildExcludeGlob());
      if (token.isCancellationRequested) {
        return;
      }
      let processedCount = 0;
      const allRules = [];
      for (const file of styleFiles) {
        if (token.isCancellationRequested) {
          return;
        }
        progress.report({
          message: `Parsing ${path.basename(file.fsPath)} (${processedCount + 1}/${styleFiles.length})...`,
          increment: 1 / styleFiles.length * 100
        });
        try {
          const doc = await vscode4.workspace.openTextDocument(file);
          allRules.push(...parseCSS(doc.getText(), file.fsPath).rules);
        } catch {
        }
        processedCount++;
      }
      progress.report({ message: "Detecting duplicate rules..." });
      const report = scanForDuplicates(allRules);
      lastReport = report;
      codeActionProvider.setReport(report);
      const config = vscode4.workspace.getConfiguration("cssDuplicateDetector");
      const severityLevel = config.get("severityLevel", "hint");
      if (severityLevel !== "none") {
        applyDiagnosticsToFiles(report, parseSeverity(severityLevel));
      }
      const editor = vscode4.window.activeTextEditor;
      if (editor && config.get("enableInlineHints", false)) {
        applyDecorations(editor, report);
      }
      updateStatusBar(report.totalGroups);
      showResultsPanel(context, report);
      vscode4.window.showInformationMessage(
        `Scanned ${processedCount} files. Found ${report.totalGroups} duplicate group${report.totalGroups !== 1 ? "s" : ""}.`,
        "Merge All"
      ).then((choice) => {
        if (choice === "Merge All") {
          vscode4.commands.executeCommand("cssDuplicateDetector.mergeAll");
        }
      });
    }
  );
}
async function scanFolder(context, folderUri) {
  if (!folderUri) {
    const picked = await vscode4.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Select Folder to Scan"
    });
    if (!picked || picked.length === 0) {
      return;
    }
    folderUri = picked[0];
  }
  const folderName = path.basename(folderUri.fsPath);
  await vscode4.window.withProgress(
    {
      location: vscode4.ProgressLocation.Notification,
      title: `CSS Duplicate Detector: Scanning "${folderName}"...`,
      cancellable: true
    },
    async (progress, token) => {
      progress.report({ message: "Finding style files..." });
      const pattern = new vscode4.RelativePattern(folderUri, "**/*.{css,scss,sass,less}");
      const styleFiles = await vscode4.workspace.findFiles(pattern, buildExcludeGlob());
      if (token.isCancellationRequested) {
        return;
      }
      if (styleFiles.length === 0) {
        vscode4.window.showInformationMessage(`No CSS/SCSS/LESS files found in "${folderName}".`);
        return;
      }
      const allRules = [];
      let processedCount = 0;
      for (const file of styleFiles) {
        if (token.isCancellationRequested) {
          return;
        }
        progress.report({
          message: `Parsing ${path.basename(file.fsPath)} (${processedCount + 1}/${styleFiles.length})...`,
          increment: 1 / styleFiles.length * 100
        });
        try {
          const doc = await vscode4.workspace.openTextDocument(file);
          allRules.push(...parseCSS(doc.getText(), file.fsPath).rules);
        } catch {
        }
        processedCount++;
      }
      const report = scanForDuplicates(allRules);
      lastReport = report;
      codeActionProvider.setReport(report);
      const config = vscode4.workspace.getConfiguration("cssDuplicateDetector");
      const severityLevel = config.get("severityLevel", "hint");
      if (severityLevel !== "none") {
        applyDiagnosticsToFiles(report, parseSeverity(severityLevel));
      }
      const editor = vscode4.window.activeTextEditor;
      if (editor && config.get("enableInlineHints", false)) {
        applyDecorations(editor, report);
      }
      updateStatusBar(report.totalGroups);
      showResultsPanel(context, report);
      vscode4.window.showInformationMessage(
        `Scanned ${processedCount} files in "${folderName}". Found ${report.totalGroups} duplicate group${report.totalGroups !== 1 ? "s" : ""}.`
      );
    }
  );
}
function dismissGroup(context, group) {
  const key = group.signature.join("|");
  dismissedSignatures.add(key);
  if (lastReport) {
    filterDismissed(lastReport);
    codeActionProvider.setReport(lastReport);
    const config = vscode4.workspace.getConfiguration("cssDuplicateDetector");
    const severityLevel = config.get("severityLevel", "hint");
    const editor = vscode4.window.activeTextEditor;
    if (editor && isSupportedFile(editor.document)) {
      if (severityLevel !== "none") {
        diagnosticCollection.set(editor.document.uri, createDiagnostics(editor.document, lastReport, parseSeverity(severityLevel)));
      } else {
        diagnosticCollection.delete(editor.document.uri);
      }
      if (config.get("enableInlineHints", false)) {
        applyDecorations(editor, lastReport);
      } else {
        clearDecorations(editor);
      }
    }
    updateStatusBar(lastReport.totalGroups);
  }
}
function dismissAll(context) {
  if (lastReport) {
    for (const g of lastReport.duplicates) {
      dismissedSignatures.add(g.signature.join("|"));
    }
    lastReport.duplicates = [];
    lastReport.totalGroups = 0;
    lastReport.totalRules = 0;
    codeActionProvider.setReport(lastReport);
    diagnosticCollection.clear();
    const editor = vscode4.window.activeTextEditor;
    if (editor) {
      clearDecorations(editor);
    }
    updateStatusBar(0);
  }
}
function filterDismissed(report) {
  report.duplicates = report.duplicates.filter(
    (g) => !dismissedSignatures.has(g.signature.join("|"))
  );
  report.totalGroups = report.duplicates.length;
  report.totalRules = report.duplicates.reduce((sum, g) => sum + g.rules.length, 0);
}
async function mergeAllInCurrentFile() {
  const editor = vscode4.window.activeTextEditor;
  if (!editor) {
    vscode4.window.showWarningMessage("No active editor.");
    return;
  }
  const parsed = parseCSS(editor.document.getText(), editor.document.uri.fsPath);
  const report = scanForDuplicates(parsed.rules);
  if (report.totalGroups === 0) {
    vscode4.window.showInformationMessage("No duplicate rules found.");
    return;
  }
  await executeMergeAll(report, editor.document.uri);
}
function applyDiagnosticsToFiles(report, severity) {
  const fileSet = /* @__PURE__ */ new Set();
  for (const group of report.duplicates) {
    for (const rule of group.rules) {
      fileSet.add(rule.filePath);
    }
  }
  for (const filePath of fileSet) {
    vscode4.workspace.openTextDocument(vscode4.Uri.file(filePath)).then((doc) => {
      diagnosticCollection.set(doc.uri, createDiagnostics(doc, report, severity));
    });
  }
}
function updateStatusBar(count) {
  if (count > 0) {
    statusBarItem.text = `$(versions) ${count} dup rule${count !== 1 ? "s" : ""}`;
    statusBarItem.backgroundColor = new vscode4.ThemeColor("statusBarItem.warningBackground");
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}
function parseSeverity(level) {
  switch (level) {
    case "error":
      return vscode4.DiagnosticSeverity.Error;
    case "warning":
      return vscode4.DiagnosticSeverity.Warning;
    case "information":
      return vscode4.DiagnosticSeverity.Information;
    case "hint":
      return vscode4.DiagnosticSeverity.Hint;
    default:
      return vscode4.DiagnosticSeverity.Hint;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
