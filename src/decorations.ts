// Inline decorations and diagnostics for duplicate CSS rules

import * as vscode from 'vscode';
import { ScanReport, DuplicateGroup } from './scanner';
import { shortenPath } from './parser';

let duplicateDecorationType: vscode.TextEditorDecorationType;

export function createDecorationTypes(): void {
  duplicateDecorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: undefined, // will use gutterIconSize with a colored dot
    overviewRulerColor: '#ffaa0066',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    isWholeLine: false,
    // Subtle left-border indicator instead of full background paint
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    borderColor: '#ffaa0044',
  });
}

export function getDecorationType() {
  return duplicateDecorationType;
}

/**
 * Apply inline decorations for duplicate rules.
 */
export function applyDecorations(
  editor: vscode.TextEditor,
  report: ScanReport
): void {
  const decorations: vscode.DecorationOptions[] = [];
  const editorPath = editor.document.uri.fsPath;

  for (const group of report.duplicates) {
    const selectors = group.rules.map(r => r.selector);
    const count = group.rules.length;

    for (const rule of group.rules) {
      if (!isMatchingFile(editorPath, rule.filePath)) { continue; }

      const line = Math.max(0, rule.line - 1);
      if (line >= editor.document.lineCount) { continue; }

      const lineText = editor.document.lineAt(line).text;
      const range = new vscode.Range(line, 0, line, lineText.length);

      decorations.push({
        range,
        hoverMessage: buildHover(group),
      });
    }
  }

  if (duplicateDecorationType) {
    editor.setDecorations(duplicateDecorationType, decorations);
  }
}

export function clearDecorations(editor: vscode.TextEditor): void {
  if (duplicateDecorationType) {
    editor.setDecorations(duplicateDecorationType, []);
  }
}

/**
 * Create diagnostics for the Problems panel.
 */
export function createDiagnostics(
  document: vscode.TextDocument,
  report: ScanReport,
  severity: vscode.DiagnosticSeverity
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const docPath = document.uri.fsPath;

  for (const group of report.duplicates) {
    for (const rule of group.rules) {
      if (!isMatchingFile(docPath, rule.filePath)) { continue; }

      const line = Math.max(0, rule.line - 1);
      if (line >= document.lineCount) { continue; }

      const lineText = document.lineAt(line).text;
      const range = new vscode.Range(line, 0, line, lineText.length);

      const msg = buildDiagnosticMessage(rule, group);
      const diag = new vscode.Diagnostic(range, msg, severity);
      diag.source = 'CSS Duplicate Detector';
      diag.code = 'duplicate-rule';
      diagnostics.push(diag);
    }
  }

  return diagnostics;
}

function buildDiagnosticMessage(rule: import('./parser').CSSRule, group: DuplicateGroup): string {
  const others = group.rules.filter(r => r !== rule);
  const propCount = group.signature.length;
  const propLabel = propCount === 1 ? 'property' : 'properties';

  // Short property summary: show first 2 property names
  const propNames = group.signature.map(s => s.split(':')[0]);
  const MAX_PROPS = 2;
  let propSummary = propNames.slice(0, MAX_PROPS).join(', ');
  if (propNames.length > MAX_PROPS) {
    propSummary += ` +${propNames.length - MAX_PROPS}`;
  }

  // Compact location list: just line numbers (or file:line for cross-file)
  const MAX_LINES = 5;
  const locations = others.slice(0, MAX_LINES).map(r => {
    const isCrossFile = r.filePath !== rule.filePath;
    return isCrossFile ? `${shortenPath(r.filePath)}:${r.line}` : `${r.line}`;
  });
  let locText = locations.join(', ');
  if (others.length > MAX_LINES) {
    locText += ` +${others.length - MAX_LINES} more`;
  }

  return `${others.length + 1} duplicate rules share ${propCount} ${propLabel} {${propSummary}} — lines ${locText}`;
}

function buildHover(group: DuplicateGroup): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  md.appendMarkdown('### CSS Duplicate Detector\n\n');
  md.appendMarkdown(`**Duplicate rule** — ${group.rules.length} selectors share ${group.signature.length} identical properties\n\n`);
  md.appendMarkdown(`Properties: \`${group.displayKey}\`\n\n`);

  const MAX_HOVER = 10;
  const shown = group.rules.slice(0, MAX_HOVER);
  for (const rule of shown) {
    md.appendMarkdown(`- \`${rule.selector}\` · \`${shortenPath(rule.filePath)}:${rule.line}\`\n`);
  }
  if (group.rules.length > MAX_HOVER) {
    md.appendMarkdown(`- ...and ${group.rules.length - MAX_HOVER} more\n`);
  }

  return md;
}

function isMatchingFile(editorPath: string, rulePath: string): boolean {
  const normEditor = editorPath.replace(/\\/g, '/').toLowerCase();
  const normRule = rulePath.replace(/\\/g, '/').toLowerCase();
  return normEditor.endsWith(normRule) || normRule.endsWith(normEditor) || normEditor === normRule;
}
