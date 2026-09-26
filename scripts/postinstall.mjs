/**
 * postinstall
 *
 * Applies patches/*.patch with patch-package. Those patches change the Kotlin
 * sources of the native Android Google Maps plugin, so they only matter to an
 * Android build, which happens on a developer machine.
 *
 * Vercel runs `npm install` too, but only to build the web bundle with Vite,
 * which never touches the plugin's Android sources. There patch-package failed
 * ("Failed to apply patch for package @capacitor/google-maps") and took the
 * whole deployment down with it, so it is skipped there. Vercel sets VERCEL=1.
 */
import { spawnSync } from 'node:child_process'

if (process.env.VERCEL) {
  console.log('postinstall: on Vercel, skipping patch-package (its patches are for the Android build only)')
  process.exit(0)
}

// shell: true so the `patch-package` binary from node_modules/.bin resolves on
// Windows too (npm puts it on PATH while a lifecycle script runs).
const result = spawnSync('patch-package', [], { stdio: 'inherit', shell: true })
process.exit(result.status ?? 1)
