// Fails when a doc or the Prettier ignore file points at a path that does not exist.
//
// Checked:
//   - every `.prettierignore` entry matches something, unless git ignores it anyway
//     (build output such as dist/ does not exist before a build);
//   - every backticked repo path in a tracked Markdown file (`src/...`, `docs/...`,
//     `scripts/...`, `public/...`) exists;
//   - every relative Markdown link resolves.
//
// Moving a folder once left .prettierignore protecting a path that no longer
// existed, which opened the vendor goldens to reformatting, and the README still
// described the old folder. Both went unnoticed until review.
//
// Not checked: glob entries in .prettierignore, backticked paths with a glob or
// placeholder in them, root files named without a folder, and anything inside a
// fenced code block, which is example rather than reference. Paths are checked on
// the file system, so a wrong-cased path passes on Windows and fails on Linux CI.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const violations = []

function gitIgnores(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path])
    return true
  } catch {
    return false
  }
}

for (const [i, raw] of readFileSync('.prettierignore', 'utf8').split('\n').entries()) {
  const entry = raw.trim()
  if (!entry || entry.startsWith('#') || /[*?[!]/.test(entry)) continue
  const path = entry.replace(/^\//, '')
  if (!existsSync(path) && !gitIgnores(path)) {
    violations.push(`.prettierignore:${i + 1}: ${entry} matches nothing`)
  }
}

const markdown = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const REPO_PATH_RE = /`((?:src|docs|scripts|public)\/[^`\s]+?)`/g
// A link target, with or without angle brackets, before any title.
const LINK_RE = /\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g

for (const file of markdown) {
  let fenced = false
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
      if (fenced) return
      for (const [, token] of line.matchAll(REPO_PATH_RE)) {
        if (/[*{}<>]/.test(token)) continue
        const path = token.replace(/:\d+(-\d+)?$/, '')
        if (!existsSync(path)) violations.push(`${file}:${i + 1}: \`${token}\` does not exist`)
      }
      for (const [, bracketed, bare] of line.matchAll(LINK_RE)) {
        const target = bracketed ?? bare
        if (/^([a-z]+:|#|\/\/)/i.test(target)) continue
        const local = decodeURIComponent(target.split('#')[0])
        // A leading slash is the repo root, as GitHub renders it.
        const path = normalize(local.startsWith('/') ? local.slice(1) : join(dirname(file), local))
        if (!existsSync(path)) violations.push(`${file}:${i + 1}: link ${target} does not resolve`)
      }
    })
}

if (violations.length) {
  console.error('Paths that point nowhere:\n' + violations.map((v) => '  ' + v).join('\n'))
  process.exit(1)
}
console.log('Paths OK')
