// Fails when copy a user reads, in code that serves every printer, names a printer
// model or brand (CODING_STANDARDS.md, "Copy the user reads").
//
// Copy written while the app drove only a P50 kept saying "P50" after it could drive
// others, in the connection panel, the print panel and the transport's chooser error,
// and only review noticed.
//
// Checked: string literals, template text and JSX text in app/, printer/drivers/ and
// printer/transport/, tests excluded, against every word of every printer profile's
// label in src/printer/profiles.ts, so a new profile is covered by adding it.
//
// Allowed: the Diagnostics panel, whose tools are x2's own; and any line marked with a
// `check-copy:` comment, on the line itself or the one above, saying why it may name
// the model, as copy shown only for that model may.
//
// Not checked: copy elsewhere (the dialect folders and profiles name their printers by
// design), and comments, which are stripped first. The stripping is line-based and
// approximate: a `//` inside a string is taken for a comment only when nothing but
// whitespace precedes it.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOTS = ['src/app', 'src/printer/drivers', 'src/printer/transport']
const ALLOWED_FILES = new Set([join('src', 'app', 'DiagnosticsPanel.tsx')])
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

/** The file's lines with comments blanked out, line numbers kept. */
function withoutComments(source) {
  const blanked = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
  return blanked.split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
}

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
const words = modelWords()
const pattern = new RegExp(`(?<![\\w/.-])(${words.map(escape).join('|')})(?![\\w-])`)

const violations = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative('.', file).split(sep).join(sep)
    if (ALLOWED_FILES.has(rel)) continue
    const raw = readFileSync(file, 'utf8').split('\n')
    const code = withoutComments(readFileSync(file, 'utf8'))
    for (const [i, line] of code.entries()) {
      if (/^\s*(import|export)\b.*\bfrom\b/.test(line)) continue
      const hit = line.match(pattern)
      if (!hit) continue
      if (raw[i].includes(MARKER) || (i > 0 && raw[i - 1].includes(MARKER))) continue
      violations.push(`${rel.split(sep).join('/')}:${i + 1}: names "${hit[1]}"`)
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
