// Code action provider — merge quick fixes for duplicate rules

import * as vscode from 'vscode';
import { ScanReport, DuplicateGroup } from './scanner';
import { mergeDuplicateGroup, applyEditsToSource } from './merger';

export class DuplicateMergeCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private report: ScanReport | null = null;

  setReport(report: ScanReport): void {
    this.report = report;
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!this.report) { return []; }

    const actions: vscode.CodeAction[] = [];
    const cursorLine = range.start.line + 1;
    const docPath = document.uri.fsPath;

    for (const group of this.report.duplicates) {
      const match = group.rules.find(
        r => isMatchingFile(docPath, r.filePath) && r.line === cursorLine
      );
      if (!match) { continue; }

      const sameFile = group.rules.every(r => isMatchingFile(docPath, r.filePath));
      if (!sameFile) { continue; }

      const selectors = group.rules.map(r => r.selector).join(', ');
      const mergeLabel = `Merge duplicate rules → ${selectors}`;

      const mergeAction = new vscode.CodeAction(mergeLabel, vscode.CodeActionKind.QuickFix);
      mergeAction.command = {
        command: 'cssDuplicateDetector.mergeGroup',
        title: mergeLabel,
        arguments: [group, document.uri],
      };
      mergeAction.isPreferred = true;
      actions.push(mergeAction);

      const dismissLabel = `Dismiss this duplicate suggestion`;
      const dismissAction = new vscode.CodeAction(dismissLabel, vscode.CodeActionKind.QuickFix);
      dismissAction.command = {
        command: 'cssDuplicateDetector.dismissGroup',
        title: dismissLabel,
        arguments: [group],
      };
      dismissAction.isPreferred = false;
      actions.push(dismissAction);
    }

    return actions;
  }
}

/**
 * Execute a single group merge with diff preview.
 */
export async function executeMergeGroup(
  group: DuplicateGroup,
  fileUri: vscode.Uri
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(fileUri);

  if (!group.rules.every(r => isMatchingFile(document.uri.fsPath, r.filePath))) {
    vscode.window.showWarningMessage('Cross-file merges are not supported yet.');
    return;
  }

  const mergeResult = mergeDuplicateGroup(group);
  const newText = applyEditsToSource(document.getText(), mergeResult.edits);

  const accepted = await showDiffPreview(document, newText, mergeResult.description);
  if (accepted) {
    await applyMerge(document, newText);
  }
}

/**
 * Execute merge-all for current file.
 */
export async function executeMergeAll(
  report: ScanReport,
  fileUri: vscode.Uri
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(fileUri);
  const docPath = document.uri.fsPath;

  const sameFileGroups = report.duplicates.filter(
    g => g.rules.every(r => isMatchingFile(docPath, r.filePath))
  );

  if (sameFileGroups.length === 0) {
    vscode.window.showInformationMessage('No duplicate rules to merge in this file.');
    return;
  }

  const allEdits = sameFileGroups.flatMap(g => mergeDuplicateGroup(g).edits);
  const newText = applyEditsToSource(document.getText(), allEdits);
  const desc = `Merge ${sameFileGroups.length} duplicate rule group(s)`;

  const accepted = await showDiffPreview(document, newText, desc);
  if (accepted) {
    await applyMerge(document, newText);
  }
}

async function showDiffPreview(
  document: vscode.TextDocument,
  newText: string,
  title: string
): Promise<boolean> {
  const beforeUri = vscode.Uri.parse(`css-dup-before:${document.uri.fsPath}`);
  const afterUri = vscode.Uri.parse(`css-dup-after:${document.uri.fsPath}`);

  const beforeProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string { return document.getText(); }
  })();
  const afterProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string { return newText; }
  })();

  const disposables = [
    vscode.workspace.registerTextDocumentContentProvider('css-dup-before', beforeProvider),
    vscode.workspace.registerTextDocumentContentProvider('css-dup-after', afterProvider),
  ];

  try {
    await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, `CSS Merge Preview: ${title}`);

    const choice = await vscode.window.showInformationMessage(
      `Apply merge: ${title}?`,
      { modal: false },
      'Apply',
      'Cancel'
    );

    return choice === 'Apply';
  } finally {
    disposables.forEach(d => d.dispose());
  }
}

async function applyMerge(document: vscode.TextDocument, newText: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
  edit.replace(document.uri, fullRange, newText);
  await vscode.workspace.applyEdit(edit);
  await document.save();
  vscode.window.showInformationMessage('CSS Duplicate Detector: Merge applied.');
}

function isMatchingFile(editorPath: string, rulePath: string): boolean {
  const normEditor = editorPath.replace(/\\/g, '/').toLowerCase();
  const normRule = rulePath.replace(/\\/g, '/').toLowerCase();
  return normEditor.endsWith(normRule) || normRule.endsWith(normEditor) || normEditor === normRule;
}
