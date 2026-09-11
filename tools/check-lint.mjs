/**
 * Храповик по линтеру.
 *
 * Линтера в проекте не было вовсе: команда `npm run lint` стояла в
 * `package.json` и звала `next lint`, а конфига не существовало ни одного
 * файла. Вопрос «а линтер у нас есть?» получал ответ «команда есть», и дальше
 * никто не смотрел.
 *
 * Поставлен oxlint — он разбирает TypeScript сам. Стандартный
 * `eslint-config-next` тянет `typescript-eslint`, а тот не поддерживает
 * TypeScript 7, на котором стоит проект: падает на загрузке, не прочитав ни
 * одного файла. Ронять версию TypeScript ради линтера — хвост, виляющий
 * собакой. Причины выключенных правил — в `tools/lint-rules.md`: комментарии
 * в JSON разбирает не всякий читатель конфига, и на них уже споткнулись двое.
 *
 * ПОЧЕМУ ХРАПОВИК, А НЕ НОЛЬ. На день установки линтер нашёл 45 замечаний.
 * Проверка, падающая с первого дня, живёт ровно до первого «давай пока
 * отключим» — это записано в самом первом храповике проекта и подтверждено
 * им же. Поэтому записывается сегодняшнее число по каждому правилу, и расти
 * ему нельзя.
 *
 * Считается ПО ПРАВИЛАМ, а не одним числом: иначе починенное в одном месте
 * оплачивает новое в другом, и база стоит на месте, пока код меняется.
 *
 * ПОЧЕМУ JSON, А НЕ РАЗБОР СТРОК. Заведено по счёту: CI покраснел на второй
 * день жизни проверки. oxlint выбирает вид вывода ПО ОКРУЖЕНИЮ — у агента
 * один, на сервере сборки другой (`::warning file=…`, разметка GitHub), в
 * терминале третий. Разбор, написанный по тому, что видно на своей машине,
 * на сервере не совпал ни с одной строкой, и проверка честно упала: «отчёта
 * нет». Вид вывода теперь назван явно (`--format=json`) и читается как
 * данные, а не как текст: у находки есть поле с именем правила, и угадывать
 * нечего.
 *
 *   node tools/check-lint.mjs              проверить
 *   node tools/check-lint.mjs --list       показать находки
 *   node tools/check-lint.mjs --update     записать текущие числа как базу
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const BASELINE = new URL('./lint-baseline.json', import.meta.url).pathname
const DIRS = ['app', 'components', 'lib']

/* В проекте, куда набор только что лёг, кода ещё нет ни строки. Проверка,
   красная с первого дня, живёт ровно до первого «давай пока отключим» —
   поэтому «папок ещё нет» это честный ноль, а не сбой. Ноль файлов при
   существующей папке — уже сбой, и он ниже. */
const here = DIRS.filter((d) => existsSync(new URL(`../${d}`, import.meta.url).pathname))
if (!here.length) {
  console.log(`· линтер: проверять пока нечего — нет ни ${DIRS.join(', ни ')}`)
  process.exit(0)
}

let out = ''
let err = ''
try {
  out = execFileSync('npx', ['oxlint', '--format=json', ...here], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (e) {
  /* oxlint выходит ненулевым, когда нашёл ошибки, — это не сбой запуска, а
     его ответ. Сбой запуска виден по тому, что отчёта нет. */
  out = e.stdout ?? ''
  err = e.stderr ?? ''
}

/* ── падение линтера — это НЕ «ноль замечаний» ────────────────────────────
 *
 * Заведено по счёту, на этой же проверке и в тот же день. Конфиг получил
 * лишний ключ, oxlint отказался его разбирать и напечатал ошибку, — а этот
 * файл увидел «ни одной строки с находкой» и бодро сообщил: «Долг сократился:
 * 45 → 0. Обновите базу.» Ещё одна такая минута, и база была бы обнулена, а
 * линтер молча выключен навсегда.
 *
 * Молчаливо неполный замер хуже отсутствующего: он выглядит как результат.
 * Поэтому отчёт обязан быть разбираемым, и в нём обязаны быть осмотренные
 * файлы. Ноль находок при нуле файлов — это «линтер не дошёл до кода». */
const fail = (why) => {
  console.error(`\n✗ ${why} — значит НЕ ПРОВЕРЕНО ничего.`)
  for (const line of (err + out).split('\n').filter(Boolean).slice(0, 6)) {
    console.error('    ' + line.slice(0, 160))
  }
  process.exit(1)
}

let report
try {
  report = JSON.parse(out)
} catch {
  fail('Линтер не отдал разбираемый отчёт')
}
if (!Array.isArray(report.diagnostics)) fail('В отчёте линтера нет списка находок')
if (!report.number_of_files) fail('Линтер не осмотрел ни одного файла')

const byRule = new Map()
for (const d of report.diagnostics) {
  /* `code` приходит как `unicorn(no-array-sort)` — имя набора и имя правила.
     В базе они пишутся через косую черту, как их зовут в конфиге. */
  const m = /^([a-z0-9-]+)\(([a-z0-9-]+)\)$/.exec(d.code ?? '')
  const key = m ? `${m[1]}/${m[2]}` : (d.code ?? 'без имени')
  const at = d.labels?.[0]?.span
  const where = at ? `${d.filename}:${at.line}:${at.column}` : d.filename
  if (!byRule.has(key)) byRule.set(key, [])
  byRule.get(key).push(`${where}: ${d.message}`)
}

const counts = Object.fromEntries([...byRule].map(([k, v]) => [k, v.length]).sort())

if (process.argv.includes('--list')) {
  for (const [rule, found] of [...byRule].sort()) {
    console.log(`\n${rule} — ${found.length}`)
    for (const f of found) console.log(`    ${f}`)
  }
  process.exit(0)
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n')
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`База обновлена: ${Object.keys(counts).length} правил, ${total} замечаний`)
  process.exit(0)
}

let base
try {
  base = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
  console.error(`Нет ${relative(ROOT, BASELINE)}. Создать: npm run check:lint -- --update`)
  process.exit(1)
}

let failed = false
for (const rule of new Set([...Object.keys(base), ...Object.keys(counts)])) {
  const now = counts[rule] ?? 0
  const was = base[rule] ?? 0
  if (now > was) {
    failed = true
    console.error(`\n✗ ${rule}: было ${was}, стало ${now}`)
    for (const f of (byRule.get(rule) ?? []).slice(0, 5)) console.error(`    ${f}`)
  } else if (now < was) {
    console.log(`✓ ${rule}: ${was} → ${now}`)
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0)
const wasTotal = Object.values(base).reduce((a, b) => a + b, 0)

if (failed) {
  console.error('\nЗамечаний линтера стало больше. Либо чините, либо — если это')
  console.error('осознанное решение — обновляйте базу: npm run check:lint -- --update')
  process.exit(1)
}

console.log(`· линтер: ${total} замечаний в ${Object.keys(counts).length} правилах, ${report.number_of_files} файлов`)
if (total < wasTotal) console.log(`\nДолг сократился: ${wasTotal} → ${total}. Обновите базу.`)
