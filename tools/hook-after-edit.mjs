/**
 * Проверка, которая запускается САМА, как только правка легла в файл.
 *
 * Заведена по слову заказчика: «я не знаю команд на проверку реакта или чего
 * такого — это всё как-то автоматически должно происходить». Должно. Хук
 * `PostToolUse` в `.claude/settings.json` зовёт этот файл после каждой
 * правки (Edit / Write), и по роду файла запускается своя проверка:
 *
 *   styles, *.css          → check:css     (шкалы, брейкпоинты, слои)
 *   app, components, lib   → check:code    (повторы, длина, хуки, склад)
 *                            + линтер, если он поставлен
 *   lib                    → тесты, если они есть (данные и формулы)
 *
 * Проверки быстрые — без браузера и без сборки, секунда-две. Тяжёлые
 * (сборка, адреса, разметка, отрисованная страница, свип) остаются шагом
 * перед сдачей: их запускает агент, не хук.
 *
 * Падение проверки уходит агенту (код выхода 2 + stderr): он видит, что
 * именно выросло, в тот же момент, а не на CI через час. Успех молчит —
 * одна строка в журнал, и всё.
 *
 * Читает JSON хука со stdin: `tool_input.file_path`. Запустить руками:
 *
 *   echo '{"tool_input":{"file_path":"styles/tokens.css"}}' | node tools/hook-after-edit.mjs
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

let input = ''
try { input = readFileSync(0, 'utf8') } catch { /* stdin пуст — нечего проверять */ }
let file = ''
try {
  const data = JSON.parse(input || '{}')
  file = data.tool_response?.filePath ?? data.tool_input?.file_path ?? ''
} catch { /* не JSON — нечего проверять */ }
if (!file) process.exit(0)

const rel = isAbsolute(file) ? relative(ROOT, file) : file
if (rel.startsWith('..')) process.exit(0)

const has = (p) => existsSync(join(ROOT, p))
const scripts = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {} } catch { return {} } })()

/** Что запускать. Имя — для журнала, команда — как её зовёт проект. */
const runs = []
const inDir = (d) => rel.startsWith(`${d}/`)
if (/\.css$/.test(rel) && has('tools/check-css.mjs')) runs.push(['check:css', 'node', ['tools/check-css.mjs']])
if (/\.(ts|tsx|js|jsx|mjs)$/.test(rel) && (inDir('app') || inDir('components') || inDir('lib'))) {
  if (has('tools/check-code.mjs')) runs.push(['check:code', 'node', ['tools/check-code.mjs']])
  if (has('tools/check-lint.mjs') && has('node_modules/.bin/oxlint')) runs.push(['check:lint', 'node', ['tools/check-lint.mjs']])
  if (inDir('lib') && scripts.test && has('tests') && has('node_modules')) runs.push(['test', 'npm', ['test', '--silent']])
}
if (!runs.length) process.exit(0)

const failed = []
const ok = []
for (const [name, cmd, args] of runs) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 90_000 })
  if (r.status === 0) ok.push(name)
  else failed.push(`✗ ${name} после правки ${rel}:\n${(r.stdout + r.stderr).trim().split('\n').slice(-25).join('\n')}`)
}

if (failed.length) {
  console.error(failed.join('\n\n'))
  console.error('\nПроверка запустилась сама, потому что файл изменён. Чините причину, не число.')
  process.exit(2)
}
console.log(`· после правки ${rel}: ${ok.join(', ')} — чисто`)
