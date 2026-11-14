// Points git at the repo's own hooks in .githooks/, so a commit runs the quick checks
// (`npm run check:static`) before it is made. Runs as `npm install`'s prepare step.
//
// Quiet, and changes nothing, unless this folder is the root of its own git checkout:
// an archive or a copy nested in another repository is left alone, so installing never
// fails over hooks. A hooks path someone set to somewhere else is kept, with a warning.

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
/** A path as one comparable string; Windows paths ignore case. */
const same = (path) => (process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path))

try {
  if (same(git('rev-parse', '--show-toplevel')) === same('.')) {
    let current = ''
    try {
      current = git('config', '--get', 'core.hooksPath')
    } catch {
      // Unset: git's own hooks folder, which is what gets replaced.
    }
    if (!current || current === '.githooks') {
      git('config', 'core.hooksPath', '.githooks')
    } else {
      console.warn(
        `install-hooks: core.hooksPath is ${current}; leaving it, so .githooks is unused.`,
      )
    }
  }
} catch {
  // No git here: nothing to hook.
}
