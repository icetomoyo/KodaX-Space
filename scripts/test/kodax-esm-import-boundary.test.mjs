import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const electronRoot = path.resolve('apps/desktop/electron');

async function productionTypeScriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'test') files.push(...(await productionTypeScriptFiles(absolute)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

test('Electron CJS main uses only type or dynamic imports for ESM-only KodaX SDK exports', async () => {
  const violations = [];
  for (const file of await productionTypeScriptFiles(electronRoot)) {
    const sourceText = await readFile(file, 'utf8');
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    const report = (node, specifier) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      violations.push(`${path.relative(electronRoot, file)}:${line} -> ${specifier}`);
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const hasRuntimeImport =
          clause === undefined ||
          (!clause.isTypeOnly &&
            (clause.name !== undefined ||
              bindings === undefined ||
              ts.isNamespaceImport(bindings) ||
              bindings.elements.some((element) => !element.isTypeOnly)));
        if (specifier.startsWith('@kodax-ai/kodax') && hasRuntimeImport) report(node, specifier);
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text;
        const clause = node.exportClause;
        const hasRuntimeExport =
          !node.isTypeOnly &&
          (clause === undefined ||
            ts.isNamespaceExport(clause) ||
            clause.elements.some((element) => !element.isTypeOnly));
        if (specifier.startsWith('@kodax-ai/kodax') && hasRuntimeExport) report(node, specifier);
      }
      if (
        ts.isImportEqualsDeclaration(node) &&
        !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression !== undefined &&
        ts.isStringLiteral(node.moduleReference.expression)
      ) {
        const specifier = node.moduleReference.expression.text;
        if (specifier.startsWith('@kodax-ai/kodax')) report(node, specifier);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const specifier = node.arguments[0].text;
        if (
          specifier.startsWith('@kodax-ai/kodax') &&
          specifier !== '@kodax-ai/kodax/package.json'
        ) {
          report(node, specifier);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.deepEqual(
    violations,
    [],
    `static SDK imports become require() in the Electron CJS bundle:\n${violations.join('\n')}`,
  );
});
