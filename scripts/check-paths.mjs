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

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const problems = []

function gitIgnores(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path])
    return true
  } catch {
    return false
  }
}

for (const [i, raw] of readFileSync('.prettierignore', 'utf8').split(/\r?\n/).entries()) {
  const entry = raw.trim()
  if (!entry || entry.startsWith('#') || /[*?[]/.test(entry)) continue
  const path = entry.replace(/^\//, '')
  if (!existsSync(path) && !gitIgnores(path)) {
    problems.push(`.prettierignore:${i + 1}: ${entry} matches nothing`)
  }
}

const markdown = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const REPO_PATH = /`((?:src|docs|scripts|public)\/[^`\s]+?)`/g
const LINK = /\]\(([^)\s]+)\)/g

for (const file of markdown) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const [, token] of line.matchAll(REPO_PATH)) {
      if (/[*{}<>]/.test(token)) continue
      const path = token.replace(/:\d+(-\d+)?$/, '')
      if (!existsSync(path)) problems.push(`${file}:${i + 1}: \`${token}\` does not exist`)
    }
    for (const [, target] of line.matchAll(LINK)) {
      if (/^([a-z]+:|#)/i.test(target)) continue
      const path = normalize(join(dirname(file), target.split('#')[0]))
      if (!existsSync(path)) problems.push(`${file}:${i + 1}: link ${target} does not resolve`)
    }
  })
}

if (problems.length) {
  console.error('Paths that point nowhere:\n' + problems.map((p) => '  ' + p).join('\n'))
  process.exit(1)
}
console.log('Paths OK')
