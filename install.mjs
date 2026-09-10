#!/usr/bin/env node
/**
 * Ставит набор в проект.
 *
 *   node install.mjs .              разложить в текущую папку
 *   node install.mjs ../новый-сайт  разложить в указанную
 *
 * Почему это отдельный скрипт, а не «склонируйте репозиторий»: набор — не
 * проект, а слой поверх проекта. Клон, ставший папкой сайта, тянет за собой
 * чужой `origin` и чужую историю: коммиты сайта поедут в набор, а следующее
 * обновление набора встретится с проектом конфликтом. Поэтому файлы
 * раскладываются внутрь проекта, а история набора остаётся в наборе.
 *
 * Затираются только одноимённые файлы набора. Ничего проектного скрипт не
 * трогает, кроме `package.json`, куда дописываются недостающие скрипты —
 * существующие имена остаются как были.
 */

import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SRC = resolve(new URL('.', import.meta.url).pathname)
const OUT = resolve(process.argv[2] ?? process.cwd())

if (OUT === SRC) {
  console.error('Целевая папка — сам набор. Укажите проект: node install.mjs ../мой-сайт')
  process.exit(1)
}

/** Своё, не переезжающее: история, зависимости, описание самого набора и
 *  этот скрипт. Всё остальное — содержимое набора и едет как есть. */
const MINE = new Set(['.git', '.gitignore', 'node_modules', 'README.md'])

const moved = []
for (const name of readdirSync(SRC)) {
  if (MINE.has(name)) continue
  cpSync(join(SRC, name), join(OUT, name), { recursive: true })
  moved.push(name)
}

/* Скрипты дописываются, а не заменяются: проектные `dev`, `build`, `start`
   у нового сайта уже свои, и набор о них ничего не знает. */
const SCRIPTS = {
  images: 'node tools/shrink.mjs',
  typecheck: 'tsc --noEmit',
  'check:css': 'node tools/check-css.mjs',
  'check:craft': 'node tools/check-craft.mjs',
  sweep: 'node tools/sweep.mjs',
  shade: 'node tools/shade.mjs',
  kit: 'node tools/kit.mjs',
}
const pkgPath = join(OUT, 'package.json')
let wired = false
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.scripts = { ...SCRIPTS, ...pkg.scripts }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  wired = true
}

console.log(`Набор разложен в ${OUT}: ${moved.join(', ')}`)
console.log('  · CLAUDE.md — правила, читаются раньше кода каждой сессией')
console.log('  · .claude/skills/craft — скилл: запреты, шкалы, примитивы, проверки')
console.log('  · .github/workflows/check.yml — проверки падают сами, без чьей-либо памяти')
console.log('  · базы храповиков на нулях — на новом проекте долга нет')
if (wired) {
  console.log('  · скрипты дописаны в package.json')
} else {
  console.log('\nВ папке нет package.json — допишите скрипты сами:')
  console.log(JSON.stringify({ scripts: SCRIPTS }, null, 2))
}
console.log('\nДальше:')
console.log('  npm i -D sharp serve wait-on && npx playwright install chromium')
console.log('  и прочитать docs/start.md — он про порядок, в котором начинать')
