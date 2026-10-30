import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const file of ['sources/cabinet/version-baseline.json', 'docs/design/design-system/tokens.json']) JSON.parse(await readFile(path.join(root, file), 'utf8'))
for (const file of ['README.md', 'REVIEW.md']) {
  const contents = await readFile(path.join(root, file), 'utf8')
  for (const match of contents.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = match[1]
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue
    const target = path.resolve(root, decodeURIComponent(href.split('#')[0]))
    const relative = path.relative(root, target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('External file link in ' + file)
    await stat(target)
  }
}
console.log('Review package documents, JSON and local links OK.')
