// CSS Duplicate Detector and Merger — VS Code Extension Entry Point

import * as vscode from 'vscode';
import * as path from 'path';
import { parseCSS, CSSRule } from './parser';
import { scanForDuplicates, ScanReport, DuplicateGroup } from './scanner';
import { createDecorationTypes, applyDecorations, clearDecorations, createDiagnostics } from './decorations';
import { DuplicateMergeCodeActionProvider, executeMergeGroup, executeMergeAll } from './codeActions';
import { showResultsPanel } from './resultsPanel';

let diagnosticCollection: vscode.DiagnosticCollection;
let codeActionProvider: DuplicateMergeCodeActionProvider;
let statusBarItem: vscode.StatusBarItem;
let lastReport: ScanReport | null = null;
const dismissedSignatures = new Set<string>();

function isExcludedFile(filePath: string): boolean {
  const config = vscode.workspace.getConfiguration('cssDuplicateDetector');
  const excludeExts = config.get<string[]>('excludeExtensions', []);
  const excludeFiles = config.get<string[]>('excludeFiles', []);
  const basename = path.basename(filePath);
  const lower = filePath.toLowerCase();

  for (const ext of excludeExts) {
    const e = ext.startsWith('.') ? ext : '.' + ext;
    if (lower.endsWith(e.toLowerCase())) { return true; }
  }

  for (const pattern of excludeFiles) {
    // Exact basename match
    if (basename === pattern) { return true; }
    // Simple glob: **/dir/** matches any path containing /dir/
    const stripped = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '');
    if (stripped !== pattern && filePath.includes(path.sep + stripped + path.sep)) { return true; }
    if (stripped !== pattern && filePath.includes('/' + stripped + '/')) { return true; }
  }

  return false;

}

function buildExcludeGlob(): string {
  const config = vscode.workspace.getConfiguration('cssDuplicateDetector');
  const excludeExts = config.get<string[]>('excludeExtensions', []);
  const excludeFiles = config.get<string[]>('excludeFiles', []);
  const parts = ['**/node_modules/**'];

  for (const ext of excludeExts) {
    const e = ext.startsWith('.') ? ext : '.' + ext;
    parts.push('**/*' + e);
  }
  for (const pattern of excludeFiles) {
    parts.push(pattern);
  }

  return '{' + parts.join(',') + '}';
}

export function activate(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('cssDuplicateDetector');
  context.subscriptions.push(diagnosticCollection);

  createDecorationTypes();

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'cssDuplicateDetector.showResults';
  statusBarItem.tooltip = 'CSS Duplicate Detector — click to view results';
  context.subscriptions.push(statusBarItem);

  codeActionProvider = new DuplicateMergeCodeActionProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'css' }, { language: 'scss' }, { language: 'less' }],
      codeActionProvider,
      { providedCodeActionKinds: DuplicateMergeCodeActionProvider.providedCodeActionKinds }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cssDuplicateDetector.scan', () => scanCurrentFile(context)),
    vscode.commands.registerCommand('cssDuplicateDetector.scanWorkspace', () => scanWorkspace(context)),
    vscode.commands.registerCommand('cssDuplicateDetector.scanFolder', (uri?: vscode.Uri) => scanFolder(context, uri)),
    vscode.commands.registerCommand('cssDuplicateDetector.mergeAll', () => mergeAllInCurrentFile()),
    vscode.commands.registerCommand('cssDuplicateDetector.mergeGroup', (group: DuplicateGroup, uri: vscode.Uri) => executeMergeGroup(group, uri)),
    vscode.commands.registerCommand('cssDuplicateDetector.dismissGroup', (group: DuplicateGroup) => dismissGroup(context, group)),
    vscode.commands.registerCommand('cssDuplicateDetector.dismissAll', () => dismissAll(context)),
    vscode.commands.registerCommand('cssDuplicateDetector.showResults', async () => {
      if (!lastReport || lastReport.totalGroups === 0) {
        vscode.window.showInformationMessage('No duplicate rules found. Run a scan first.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        [
          { label: '$(list-unordered) Show Results', description: `${lastReport.totalGroups} duplicate groups`, id: 'show' },
          { label: '$(merge) Merge All', description: 'Merge all duplicates in current file', id: 'merge' },
          { label: '$(close) Dismiss All', description: 'Dismiss all current suggestions', id: 'dismiss' },
          { label: '$(eye-closed) Hide Status Bar', description: 'Hide until next scan', id: 'hide' },
        ],
        { placeHolder: 'CSS Duplicate Detector' }
      );
      if (!pick) { return; }
      switch (pick.id) {
        case 'show': showResultsPanel(context, lastReport); break;
        case 'merge': vscode.commands.executeCommand('cssDuplicateDetector.mergeAll'); break;
        case 'dismiss': vscode.commands.executeCommand('cssDuplicateDetector.dismissAll'); break;
        case 'hide': statusBarItem.hide(); break;
      }
    }),
    vscode.commands.registerCommand('cssDuplicateDetector.clearDiagnostics', () => {
      diagnosticCollection.clear();
      dismissedSignatures.clear();
      lastReport = null;
      const editor = vscode.window.activeTextEditor;
      if (editor) { clearDecorations(editor); }
      updateStatusBar(0);
      vscode.window.showInformationMessage('CSS Duplicate Detector: Diagnostics cleared.');
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isSupportedFile(doc)) { scanDocument(context, doc); }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isSupportedFile(editor.document)) {
        scanDocument(context, editor.document);
      }
    })
  );

  if (vscode.window.activeTextEditor) {
    const doc = vscode.window.activeTextEditor.document;
    if (isSupportedFile(doc)) {
      scanDocument(context, doc);
    }
  }
}

export function deactivate(): void {
  diagnosticCollection?.dispose();
  statusBarItem?.dispose();
}

function isSupportedFile(doc: vscode.TextDocument): boolean {
  return ['css', 'scss', 'less'].includes(doc.languageId) && !isExcludedFile(doc.uri.fsPath);
}

async function scanCurrentFile(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor to scan.');
    return;
  }
  await scanDocument(context, editor.document);
  if (lastReport && lastReport.totalGroups > 0) {
    showResultsPanel(context, lastReport);
  }
}

async function scanDocument(context: vscode.ExtensionContext, document: vscode.TextDocument): Promise<void> {
  const parsed = parseCSS(document.getText(), document.uri.fsPath);
  const report = scanForDuplicates(parsed.rules);
  filterDismissed(report);
  lastReport = report;
  codeActionProvider.setReport(report);

  const config = vscode.workspace.getConfiguration('cssDuplicateDetector');
  const severityLevel = config.get<string>('severityLevel', 'hint');
  if (severityLevel === 'none') {
    diagnosticCollection.delete(document.uri);
  } else {
    const severity = parseSeverity(severityLevel);
    const diags = createDiagnostics(document, report, severity);
    diagnosticCollection.set(document.uri, diags);
  }

  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.fsPath === document.uri.fsPath) {
    if (config.get<boolean>('enableInlineHints', false)) {
      applyDecorations(editor, report);
    } else {
      clearDecorations(editor);
    }
  }

  updateStatusBar(report.totalGroups);
}

async function scanWorkspace(context: vscode.ExtensionContext): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CSS Duplicate Detector: Scanning workspace...',
      cancellable: true,
    },
    async (progress, token) => {
      diagnosticCollection.clear();
      progress.report({ message: 'Finding style files...' });

      const styleFiles = await vscode.workspace.findFiles('**/*.{css,scss,sass,less}', buildExcludeGlob());
      if (token.isCancellationRequested) { return; }

      let processedCount = 0;
      const allRules: CSSRule[] = [];

      for (const file of styleFiles) {
        if (token.isCancellationRequested) { return; }
        progress.report({
          message: `Parsing ${path.basename(file.fsPath)} (${processedCount + 1}/${styleFiles.length})...`,
          increment: (1 / styleFiles.length) * 100,
        });
        try {
          const doc = await vscode.workspace.openTextDocument(file);
          allRules.push(...parseCSS(doc.getText(), file.fsPath).rules);
        } catch { /* skip */ }
        processedCount++;
      }

      progress.report({ message: 'Detecting duplicate rules...' });
      const report = scanForDuplicates(allRules);
      lastReport = report;
      codeActionProvider.setReport(report);

      const config = vscode.workspace.getConfiguration('cssDuplicateDetector');
      const severityLevel = config.get<string>('severityLevel', 'hint');
      if (severityLevel !== 'none') {
        applyDiagnosticsToFiles(report, parseSeverity(severityLevel));
      }

      const editor = vscode.window.activeTextEditor;
      if (editor && config.get<boolean>('enableInlineHints', false)) {
        applyDecorations(editor, report);
      }
      updateStatusBar(report.totalGroups);
      showResultsPanel(context, report);

      vscode.window.showInformationMessage(
        `Scanned ${processedCount} files. Found ${report.totalGroups} duplicate group${report.totalGroups !== 1 ? 's' : ''}.`,
        'Merge All'
      ).then(choice => {
        if (choice === 'Merge All') {
          vscode.commands.executeCommand('cssDuplicateDetector.mergeAll');
        }
      });
    }
  );
}

async function scanFolder(context: vscode.ExtensionContext, folderUri?: vscode.Uri): Promise<void> {
  if (!folderUri) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: 'Select Folder to Scan',
    });
    if (!picked || picked.length === 0) { return; }
    folderUri = picked[0];
  }

  const folderName = path.basename(folderUri.fsPath);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `CSS Duplicate Detector: Scanning "${folderName}"...`,
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: 'Finding style files...' });
      const pattern = new vscode.RelativePattern(folderUri!, '**/*.{css,scss,sass,less}');
      const styleFiles = await vscode.workspace.findFiles(pattern, buildExcludeGlob());

      if (token.isCancellationRequested) { return; }
      if (styleFiles.length === 0) {
        vscode.window.showInformationMessage(`No CSS/SCSS/LESS files found in "${folderName}".`);
        return;
      }

      const allRules: CSSRule[] = [];
      let processedCount = 0;

      for (const file of styleFiles) {
        if (token.isCancellationRequested) { return; }
        progress.report({
          message: `Parsing ${path.basename(file.fsPath)} (${processedCount + 1}/${styleFiles.length})...`,
          increment: (1 / styleFiles.length) * 100,
        });
        try {
          const doc = await vscode.workspace.openTextDocument(file);
          allRules.push(...parseCSS(doc.getText(), file.fsPath).rules);
        } catch { /* skip */ }
        processedCount++;
      }

      const report = scanForDuplicates(allRules);
      lastReport = report;
      codeActionProvider.setReport(report);

      const config = vscode.workspace.getConfiguration('cssDuplicateDetector');
      const severityLevel = config.get<string>('severityLevel', 'hint');
      if (severityLevel !== 'none') {
        applyDiagnosticsToFiles(report, parseSeverity(severityLevel));
      }

      const editor = vscode.window.activeTextEditor;
      if (editor && config.get<boolean>('enableInlineHints', false)) {
        applyDecorations(editor, report);
      }
      updateStatusBar(report.totalGroups);
      showResultsPanel(context, report);

      vscode.window.showInformationMessage(
        `Scanned ${processedCount} files in "${folderName}". Found ${report.totalGroups} duplicate group${report.totalGroups !== 1 ? 's' : ''}.`
      );
    }
  );
}

function dismissGroup(context: vscode.ExtensionContext, group: DuplicateGroup): void {
  const key = group.signature.join('|');
  dismissedSignatures.add(key);

  if (lastReport) {
    filterDismissed(lastReport);
    codeActionProvider.setReport(lastReport);

    const config = vscode.workspace.getConfiguration('cssDuplicateDetector');
    const severityLevel = config.get<string>('severityLevel', 'hint');

    const editor = vscode.window.activeTextEditor;
    if (editor && isSupportedFile(editor.document)) {
      if (severityLevel !== 'none') {
        diagnosticCollection.set(editor.document.uri, createDiagnostics(editor.document, lastReport, parseSeverity(severityLevel)));
      } else {
        diagnosticCollection.delete(editor.document.uri);
      }
      if (config.get<boolean>('enableInlineHints', false)) {
        applyDecorations(editor, lastReport);
      } else {
        clearDecorations(editor);
      }
    }
    updateStatusBar(lastReport.totalGroups);
  }
}

function dismissAll(context: vscode.ExtensionContext): void {
  if (lastReport) {
    for (const g of lastReport.duplicates) {
      dismissedSignatures.add(g.signature.join('|'));
    }
    lastReport.duplicates = [];
    lastReport.totalGroups = 0;
    lastReport.totalRules = 0;
    codeActionProvider.setReport(lastReport);

    diagnosticCollection.clear();
    const editor = vscode.window.activeTextEditor;
    if (editor) { clearDecorations(editor); }
    updateStatusBar(0);
  }
}

function filterDismissed(report: ScanReport): void {
  report.duplicates = report.duplicates.filter(
    g => !dismissedSignatures.has(g.signature.join('|'))
  );
  report.totalGroups = report.duplicates.length;
  report.totalRules = report.duplicates.reduce((sum, g) => sum + g.rules.length, 0);
}

async function mergeAllInCurrentFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('No active editor.'); return; }

  const parsed = parseCSS(editor.document.getText(), editor.document.uri.fsPath);
  const report = scanForDuplicates(parsed.rules);

  if (report.totalGroups === 0) {
    vscode.window.showInformationMessage('No duplicate rules found.');
    return;
  }
  await executeMergeAll(report, editor.document.uri);
}

function applyDiagnosticsToFiles(report: ScanReport, severity: vscode.DiagnosticSeverity): void {
  const fileSet = new Set<string>();
  for (const group of report.duplicates) {
    for (const rule of group.rules) {
      fileSet.add(rule.filePath);
    }
  }
  for (const filePath of fileSet) {
    vscode.workspace.openTextDocument(vscode.Uri.file(filePath)).then(doc => {
      diagnosticCollection.set(doc.uri, createDiagnostics(doc, report, severity));
    });
  }
}

function updateStatusBar(count: number): void {
  if (count > 0) {
    statusBarItem.text = `$(versions) ${count} dup rule${count !== 1 ? 's' : ''}`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

function parseSeverity(level: string): vscode.DiagnosticSeverity {
  switch (level) {
    case 'error': return vscode.DiagnosticSeverity.Error;
    case 'warning': return vscode.DiagnosticSeverity.Warning;
    case 'information': return vscode.DiagnosticSeverity.Information;
    case 'hint': return vscode.DiagnosticSeverity.Hint;
    default: return vscode.DiagnosticSeverity.Hint;
  }
}
