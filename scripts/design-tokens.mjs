import { readFile, writeFile } from 'node:fs/promises'
const source = JSON.parse(await readFile(new URL('../docs/design/design-system/tokens.json', import.meta.url), 'utf8'))
const variables = []
for (const category of ['color', 'spacing', 'radius', 'size', 'motion']) {
  for (const { name, value } of source[category].tokens) variables.push(`  --${name}: ${value.replace(/\{([^}]+)\}/g, 'var(--$1)')};`)
}
variables.push(`  --font-sans: ${source.type.families.sans};`)
for (const style of source.type.groups.flatMap(group => group.styles)) {
  for (const key of ['fontSize', 'lineHeight', 'fontWeight', 'letterSpacing']) {
    if (style[key] !== undefined) variables.push(`  --${style.name}-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${style[key]};`)
  }
}
const css = `/* Generated from docs/design/design-system/tokens.json. Do not edit. */\n:root {\n${variables.join('\n')}\n}\n`
const target = new URL('../src/tokens.css', import.meta.url)
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8')).replace(/\r\n/g, '\n') !== css) throw new Error('Run npm run design:tokens to update the theme.')
} else await writeFile(target, css)
