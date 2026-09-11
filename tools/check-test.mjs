/**
 * Прогон тестов, который не умеет соврать.
 *
 * `node --test` на папке без тестов отвечает «0 тестов, 0 упало» и выходит с
 * нулём. Сборка зеленеет, не проверив ничего, — и это ровно та болезнь, что
 * в этот же день поймана у линтера: молчаливый ноль выглядит как результат.
 * Стоила она дорого: проверка линтера успела сообщить «долг сократился с 45
 * до 0» в минуту, когда линтер просто не запустился.
 *
 * Поэтому здесь ноль тестов — это падение, а не успех. Новый проект, куда
 * набор только что лёг, получает вместе с ним тест-образец: `npm test` в
 * первый же день должен проверять хоть что-то, иначе команда заводится
 * зелёной и такой и остаётся.
 *
 *   node tools/check-test.mjs                      все тесты
 *   node tools/check-test.mjs tests/format.test.ts  один файл, как при правке
 */

import { execFileSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname
/* Вид отчёта назван явно. Он зависит от окружения — у агента один, на
   сервере сборки другой, — и разбор, написанный по тому, что видно на своей
   машине, на сервере не совпадёт ни с одной строкой. Это уже случилось с
   линтером и стоило красной сборки. */
/* Путь аргументом — это работа по одному тесту: при правке гоняют тот
   файл, который сейчас красный, а не всю папку. Без этого разработка через
   тест превращается в ожидание всего прогона на каждую строку. */
const WHAT = process.argv.slice(2)
const ARGS = ['--test', '--test-reporter=tap', ...(WHAT.length ? WHAT : ['tests/**/*.test.ts'])]

let out = ''
let code = 0
try {
  out = execFileSync(process.execPath, ARGS, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (e) {
  out = (e.stdout ?? '') + (e.stderr ?? '')
  code = e.status ?? 1
}

process.stdout.write(out)

const num = (name) => {
  const m = new RegExp(`^# ${name} (\\d+)$`, 'm').exec(out)
  return m ? Number(m[1]) : null
}
const tests = num('tests')
const failed = num('fail')

if (tests === null || failed === null) {
  console.error('\n✗ Прогон не отдал итога — значит НЕ ПРОВЕРЕНО ничего.')
  process.exit(1)
}
if (tests === 0) {
  console.error('\n✗ Тестов не найдено ни одного — «0 упало» здесь не ответ, а тишина.')
  console.error('    Тесты живут в tests/*.test.ts. Начните с того, что уже ломалось.')
  process.exit(1)
}
if (failed > 0 || code !== 0) process.exit(1)

console.log(`· тесты: ${tests} прошли`)
