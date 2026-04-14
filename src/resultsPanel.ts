// Results Panel — shows all duplicate rules in a webview tab

import * as vscode from 'vscode';
import { ScanReport, DuplicateGroup } from './scanner';
import { CSSRule, shortenPath } from './parser';
import { applyEditsToSource, MergeEdit } from './merger';

let currentPanel: vscode.WebviewPanel | undefined;

export function showResultsPanel(
  context: vscode.ExtensionContext,
  report: ScanReport
): void {
  if (currentPanel) {
    currentPanel.webview.html = buildHtml(report);
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'cssDuplicateResults',
    'CSS Duplicate Rules',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  currentPanel.webview.html = buildHtml(report);

  currentPanel.webview.onDidReceiveMessage(
    async (msg) => {
      if (msg.command === 'openFile') {
        const uri = vscode.Uri.file(msg.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        const line = Math.max(0, (msg.line ?? 1) - 1);
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      } else if (msg.command === 'dismiss') {
        const group = report.duplicates[msg.index];
        if (group) {
          await vscode.commands.executeCommand('cssDuplicateDetector.dismissGroup', group);
          report.duplicates.splice(msg.index, 1);
          report.totalGroups = report.duplicates.length;
          report.totalRules = report.duplicates.reduce((s: number, g: DuplicateGroup) => s + g.rules.length, 0);
          currentPanel!.webview.html = buildHtml(report);
        }
      } else if (msg.command === 'merge') {
        const group = report.duplicates[msg.index];
        if (group) {
          const fileUri = vscode.Uri.file(group.rules[0].filePath);
          await vscode.commands.executeCommand('cssDuplicateDetector.mergeGroup', group, fileUri);
        }
      } else if (msg.command === 'mergeAll') {
        await vscode.commands.executeCommand('cssDuplicateDetector.mergeAll');
      } else if (msg.command === 'diffRule') {
        const group = report.duplicates[msg.groupIndex];
        const rule = group?.rules[msg.ruleIndex];
        if (rule) { await showRuleDiffPreview(rule); }
      } else if (msg.command === 'deleteRule') {
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
            report.totalRules = report.duplicates.reduce((s: number, g: DuplicateGroup) => s + g.rules.length, 0);
            currentPanel!.webview.html = buildHtml(report);
          }
        }
      }
    },
    undefined,
    context.subscriptions
  );

  currentPanel.onDidDispose(() => { currentPanel = undefined; });
}

/**
 * Show a diff preview highlighting what removing this rule looks like.
 */
async function showRuleDiffPreview(rule: CSSRule): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(rule.filePath));
  const original = doc.getText();
  const edit: MergeEdit = {
    description: `Remove "${rule.selector}"`,
    filePath: rule.filePath,
    originalText: rule.rawText,
    replacementText: '',
    startOffset: rule.startOffset,
    endOffset: rule.endOffset,
  };
  const newText = applyEditsToSource(original, [edit]);

  const beforeUri = vscode.Uri.parse(`css-dup-before:${doc.uri.fsPath}`);
  const afterUri = vscode.Uri.parse(`css-dup-after:${doc.uri.fsPath}`);

  const beforeProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string { return original; }
  })();
  const afterProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string { return newText; }
  })();

  const disposables = [
    vscode.workspace.registerTextDocumentContentProvider('css-dup-before', beforeProvider),
    vscode.workspace.registerTextDocumentContentProvider('css-dup-after', afterProvider),
  ];

  await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri,
    `Diff: Remove "${rule.selector}" — ${shortenPath(rule.filePath)}:${rule.line}`);

  setTimeout(() => disposables.forEach(d => d.dispose()), 30000);
}

/**
 * Delete a single rule from its file with diff preview + confirmation.
 */
async function deleteRuleWithPreview(rule: CSSRule): Promise<boolean> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(rule.filePath));
  const original = doc.getText();
  const edit: MergeEdit = {
    description: `Remove "${rule.selector}"`,
    filePath: rule.filePath,
    originalText: rule.rawText,
    replacementText: '',
    startOffset: rule.startOffset,
    endOffset: rule.endOffset,
  };
  const newText = applyEditsToSource(original, [edit]);

  const beforeUri = vscode.Uri.parse(`css-dup-before:${doc.uri.fsPath}`);
  const afterUri = vscode.Uri.parse(`css-dup-after:${doc.uri.fsPath}`);

  const beforeProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string { return original; }
  })();
  const afterProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string { return newText; }
  })();

  const disposables = [
    vscode.workspace.registerTextDocumentContentProvider('css-dup-before', beforeProvider),
    vscode.workspace.registerTextDocumentContentProvider('css-dup-after', afterProvider),
  ];

  try {
    await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri,
      `Delete: "${rule.selector}" — ${shortenPath(rule.filePath)}:${rule.line}`);

    const choice = await vscode.window.showInformationMessage(
      `Delete rule "${rule.selector}" from ${shortenPath(rule.filePath)}:${rule.line}?`,
      { modal: false }, 'Delete', 'Cancel'
    );

    if (choice === 'Delete') {
      const wsEdit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(original.length));
      wsEdit.replace(doc.uri, fullRange, newText);
      await vscode.workspace.applyEdit(wsEdit);
      await doc.save();
      return true;
    }
  } finally {
    disposables.forEach(d => d.dispose());
  }
  return false;
}

function buildHtml(report: ScanReport): string {
  const groupCards = report.duplicates.map((g, i) => buildGroupCard(g, i)).join('\n');
  const empty = report.duplicates.length === 0
    ? `<div class="empty">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="2"/>
          <path d="M16 28c2 4 8 6 12 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="18" cy="20" r="2" fill="currentColor"/>
          <circle cx="30" cy="20" r="2" fill="currentColor"/>
        </svg>
        <p>No duplicate rules found!</p>
      </div>`
    : '';

  return /* html */`<!DOCTYPE html>
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
  <h1>⚡ Duplicate CSS Rules</h1>
  <div class="subtitle">${report.totalGroups} duplicate group${report.totalGroups !== 1 ? 's' : ''} · ${report.totalRules} rules</div>

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
    ` : ''}
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
</html>`;
}

function buildGroupCard(group: DuplicateGroup, index: number): string {
  const locationsHtml = group.rules.map((rule, ruleIdx) => /* html */`
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
  `).join('\n');

  const combinedSel = group.rules.map(r => r.selector).join(', ');
  const propsText = group.rules[0].properties
    .map(p => `  ${p.name}: ${p.value}${p.important ? ' !important' : ''};`)
    .join('\n');
  const mergePreview = `${combinedSel} {\n${propsText}\n}`;

  const files = new Set(group.rules.map(r => r.filePath));
  const isSameFile = files.size === 1;
  const mergeBtn = isSameFile
    ? `<button class="merge-btn" data-index="${index}">Merge with Diff</button>`
    : `<span class="cross-file-note">Cross-file — merge manually</span>`;

  return /* html */`
  <div class="group-card collapsed">
    <div class="group-header">
      <div class="group-header-top">
        <span class="chevron">▼</span>
        <span class="group-title">Identical property set</span>
        <span class="count-badge">${group.rules.length} selectors</span>
      </div>
      <div class="props-list">${esc(group.displayKey)}</div>
    </div>
    <div class="group-body">
      ${locationsHtml}
      <div class="merge-preview">
        <div class="merge-label">→ After merge</div>
        <div class="merge-code">${esc(mergePreview)}</div>
      </div>
      <div class="card-actions">
        ${mergeBtn}
        <button class="dismiss-btn" data-index="${index}">Dismiss</button>
      </div>
    </div>
  </div>`;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
