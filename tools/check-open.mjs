/**
 * Открывается ли каждая страница — в РАЗРАБОТКЕ, а не только в сборке.
 *
 * Заведено по дефекту соседнего магазина, и дефект прожил в `main` восемь
 * дней: `<Image>` с `fill` и `width` разом. Боевой сайт отдавал 200, а
 * главная, каталог и поиск в разработке падали — работать над ними было
 * нельзя. Обе отрисованные проверки ходили по собранной витрине и обе были
 * зелёные: ответ у них честный, он просто про другую подачу.
 *
 * Часть проверок фреймворк делает только в `dev`. Значит просить каждую
 * страницу дерева маршрутов надо и там — иначе «зелено» означает «зелено на
 * одной из трёх подач», а сломанной оказывается та, в которой работают.
 *
 * Браузера здесь нет и снимков нет: спрашивается только код ответа и то, что
 * в ответе настоящая страница, а не экран ошибки. Сто восемь адресов
 * проходят за полминуты.
 *
 *   node tools/check-open.mjs            поднять `next dev` и обойти всё
 *   node tools/check-open.mjs --built    обойти уже поднятый сайт (SITE=…)
 *
 * Ставится ПЕРЕД сборкой: обе пишут в `.next`, и последней должна
 * заканчиваться сборка.
 */

import { spawn } from 'node:child_process'
import { all, sample } from './routes.mjs'

const PORT = Number(process.env.PORT ?? 3197)
const BASE = process.env.SITE ?? `http://127.0.0.1:${PORT}`
const built = process.argv.includes('--built')
const urls = all()

let dev = null
if (!built) {
  /* Своей группой процессов — и убивать её целиком. `next dev` поднимает
     под собой ещё один процесс, и SIGTERM одному лишь родителю оставляет
     сервер жить: проверка тогда не завершается вовсе, а выглядит как
     «долго идёт». Полчаса ушло ровно на это. */
  dev = spawn('npx', ['next', 'dev', '--port', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, BROWSER: 'none' },
  })
  const log = []
  dev.stdout.on('data', (d) => log.push(String(d)))
  dev.stderr.on('data', (d) => log.push(String(d)))

  /* Ждём не «сколько-нибудь миллисекунд», а признак: сервер ответил. Число
     миллисекунд врёт на любой машине, кроме той, где его подобрали. */
  const until = Date.now() + 90_000
  let up = false
  while (Date.now() < until && !up) {
    await new Promise((r) => setTimeout(r, 500))
    if (dev.exitCode !== null) break
    up = await fetch(BASE, { redirect: 'manual' }).then(() => true, () => false)
  }
  if (!up) {
    console.error(`\n✗ next dev не поднялся за 90 секунд на ${BASE}.`)
    console.error(log.join('').split('\n').slice(-20).map((l) => `    ${l}`).join('\n'))
    stop()
    process.exit(1)
  }
}

/** Убить сервер вместе со всем, что он под собой поднял. */
const stop = () => {
  if (!dev) return
  try { process.kill(-dev.pid, 'SIGTERM') } catch { dev.kill('SIGTERM') }
}
process.on('exit', stop)

const bad = []

/** Один запрос со сроком. */
const ask = (url) =>
  fetch(BASE + url, { redirect: 'manual', signal: AbortSignal.timeout(60_000) })

/* Разогрев: по одному адресу на форму маршрута, ПО ОЧЕРЕДИ.
 *
 * Сервер разработки собирает страницу на первый запрос к ней, и четыре
 * запроса, пришедшие к несобранной форме разом, получают 500 — не потому
 * что страница сломана, а потому что её ещё нет. Первый честный прогон этой
 * проверки так и сказал: «/bg/404 — 500», а тот же адрес в одиночку
 * отдавался с 200.
 *
 * Проверка обязана мерить то, что видит человек, а человек обновляет
 * страницу. Поэтому сперва по разу на форму, и только потом обход. */
for (const url of built ? [] : sample()) await ask(url).catch(() => {})

/* По четыре разом: формы уже собраны, дальше идёт чтение готового. */
const queue = [...urls]
const worker = async () => {
  for (let url = queue.shift(); url; url = queue.shift()) {
    let res
    try {
      /* Свой срок у каждого запроса: сервер, задумавшийся на одном адресе,
         иначе останавливает весь обход и выглядит как медленная проверка. */
      res = await ask(url)
      /* Второй заход на ответ сервера: страница, собирающаяся прямо сейчас,
         отдаёт 500 один раз. Сломанная отдаёт его оба. */
      if (res.status >= 500) res = await ask(url)
    } catch (e) {
      bad.push(`${url} — не ответил: ${e.message}`)
      continue
    }
    const html = await res.text()
    if (res.status !== 200) { bad.push(`${url} — ${res.status}`); continue }
    /* Экран ошибки разработки отдаётся с кодом 200: код тут не признак.
       Признак — что в ответе нет страницы сайта. */
    if (!/<main[\s>]/.test(html)) {
      const why = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'без <main>'
      bad.push(`${url} — 200, но это не страница: ${why.slice(0, 70)}`)
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()])

stop()

if (bad.length) {
  console.error(`\n✗ Не открылось: ${bad.length} из ${urls.length}`)
  for (const b of bad.slice(0, 20)) console.error(`    ${b}`)
  if (bad.length > 20) console.error(`    …и ещё ${bad.length - 20}`)
  console.error('\n  Это НЕ храповик: страница, которая не открывается, — не долг,')
  console.error('  который платят в своём темпе.')
  process.exit(1)
}

console.log(`· открылись все ${urls.length} адресов (${built ? 'собранный сайт' : 'next dev'})`)
/* Явный выход: соединения `fetch` держат цикл событий ещё несколько секунд
   после последнего ответа, и проверка выглядела бы висящей. */
process.exit(0)
