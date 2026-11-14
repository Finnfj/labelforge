// Fails when copy a user reads, in code that serves every printer, names a printer
// model or brand (CODING_STANDARDS.md, "Copy the user reads").
//
// Copy written while the app drove only a P50 kept saying "P50" after it could drive
// others, in the connection panel, the print panel and the transport's chooser error,
// and only review noticed.
//
// Checked: string literals, template text and JSX text — read with the TypeScript
// parser, so identifiers, comments and import paths are never mistaken for copy — in
// app/, printer/drivers/ and printer/transport/, tests excluded. Matched, ignoring
// case, against every word of every printer profile's label in
// src/printer/profiles.ts, so a new profile is covered by adding it.
//
// Allowed: the Diagnostics panel, whose tools are x2's own; and copy with a
// `check-copy:` comment on the line the copy starts on, or the line above, saying why
// it may name the model, as copy shown only for that model may. The rest of src/printer/ — the
// profiles and the dialects — names its printers by design and is not scanned.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOTS = ['src/app', 'src/printer/drivers', 'src/printer/transport']
const ALLOWED_FILES = new Set(['src/app/DiagnosticsPanel.tsx'])
const MARKER = 'check-copy:'

/** Every word of every profile label: the models and brands copy may not name. */
function modelWords() {
  const source = readFileSync('src/printer/profiles.ts', 'utf8')
  const words = new Set()
  for (const [, label] of source.matchAll(/^\s*label: ['"]([^'"]+)['"]/gm)) {
    for (const word of label.split(/[\s/]+/)) if (/[A-Za-z]/.test(word)) words.add(word)
  }
  if (words.size === 0) throw new Error('check-copy: found no profile labels in profiles.ts')
  return [...words]
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) yield path
  }
}

const COPY_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
])

/** A module path, not copy: `import … from '…'`, `export … from '…'`, `import('…')`. */
function isModulePath(node) {
  const parent = node.parent
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true
  return ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword
}

/** Every piece of copy in a file, with the line it starts on (0-based). */
function copyIn(file, text) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const copy = []
  const visit = (node) => {
    if (COPY_KINDS.has(node.kind) && !isModulePath(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
      copy.push({ line, text: node.text })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return copy
}

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
const pattern = new RegExp(`(?<![\\w/.-])(${modelWords().map(escape).join('|')})(?![\\w-])`, 'i')

const violations = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative('.', file).replaceAll('\\', '/')
    if (ALLOWED_FILES.has(rel)) continue
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (const copy of copyIn(file, text)) {
      const hit = copy.text.match(pattern)
      if (!hit) continue
      const marked = [copy.line, copy.line - 1].some((n) => lines[n]?.includes(MARKER))
      if (!marked) violations.push(`${rel}:${copy.line + 1}: names "${hit[1]}"`)
    }
  }
}

if (violations.length) {
  console.error('Copy that serves every printer names a model:\n')
  for (const v of violations) console.error('  ' + v)
  console.error(
    `\nName no model here, or say why this copy may, in a "${MARKER}" comment on the line.`,
  )
  process.exit(1)
}
console.log('Copy OK')
