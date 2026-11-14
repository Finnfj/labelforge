// Points git at the repo's own hooks in .githooks/, so a commit runs the quick checks
// (`npm run check:static`) before it is made. Runs as `npm install`'s prepare step.
//
// Quiet where there is no git to configure, such as an installed package or an
// archive, so installing never fails over hooks.

import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
} catch {
  // No git here: nothing to hook.
}
