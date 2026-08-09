// Enforces the architectural layering described in docs/ and the plan:
//
//   app/     -> may import anything
//   editor/  -> may not import printer/
//   render/  -> may not import printer/ or react
//   printer/ -> may not import fabric, react, or editor/
//   model/   -> leaf; may not import any other layer
//
// The point is that hardware concerns stay quarantined in printer/, so the editor
// and renderer remain testable with no Bluetooth in sight.
//
// Also bans the vendor SDK outright — we deliberately depend on none of it.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = 'src'

/** layer -> array of forbidden import substrings */
const RULES = {
  editor: ['printer/', '/printer'],
  render: ['printer/', '/printer', 'react'],
  printer: ['fabric', 'react', 'editor/', '/editor'],
  model: ['printer/', 'editor/', 'render/', 'fabric', 'react', 'pako'],
}

const BANNED_EVERYWHERE = ['marklife-label-printer-web-kit']

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.tsx?$/.test(p)) yield p
  }
}

const violations = []

for (const file of walk(SRC)) {
  const rel = relative(SRC, file)
  const layer = rel.split(sep)[0]
  const source = readFileSync(file, 'utf8')

  const specifiers = []
  for (const m of source.matchAll(IMPORT_RE)) specifiers.push(m[1] ?? m[2])

  for (const spec of specifiers) {
    for (const banned of BANNED_EVERYWHERE) {
      if (spec.includes(banned)) {
        violations.push(`${rel}: imports banned package "${spec}"`)
      }
    }
    for (const forbidden of RULES[layer] ?? []) {
      // "react" must match the package, not e.g. "react-dom" inside app/
      const hit = forbidden === 'react' ? spec === 'react' || spec.startsWith('react/') : spec.includes(forbidden)
      if (hit) {
        violations.push(`${rel}: layer "${layer}" must not import "${spec}"`)
      }
    }
  }
}

if (violations.length) {
  console.error('Layering violations:\n')
  for (const v of violations) console.error('  ' + v)
  console.error(`\n${violations.length} violation(s). See scripts/check-layering.mjs for the rules.`)
  process.exit(1)
}

console.log('Layering OK')
