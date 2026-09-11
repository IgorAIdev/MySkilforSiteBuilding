/**
 * Адреса: обещанное открывается, открытое обещано.
 *
 * Заведено по дефекту соседнего магазина, и он самый дорогой из всех
 * записанных: у товара переводился адрес, а карта сайта продолжала клеить
 * `/en/` + болгарский путь. Восемьдесят четыре адреса из карты отвечали «не
 * найдено», ровно столько же настоящих английских страниц в карту не
 * попадало вовсе, а `hreflang` называл несуществующего двойника — то есть
 * сообщал поисковику, что английской версии нет.
 *
 * Заметить это глазами невозможно: обе половины выглядят правдоподобно,
 * страницы открываются, карта отдаётся. Видно только обходом.
 *
 * Поэтому проверка двусторонняя, и обе стороны обязательны:
 *
 *   1. ОБЕЩАННОЕ ОТКРЫВАЕТСЯ. Каждый адрес из карты сайта, каждый
 *      `canonical` и каждый `hreflang` в собранных страницах — существует
 *      файлом. Указать на адрес, которого нет, хуже, чем не указать ни на
 *      что: поисковик сходит по нему один раз и перестанет верить остальным.
 *
 *   2. ОТКРЫТОЕ ОБЕЩАНО РОВНО ОДИН РАЗ. Каждая собранная страница либо стоит
 *      в карте сайта, либо прямо сказала о себе `noindex`. Молчание — это не
 *      «страница не для поиска», это страница, которую поиск найдёт и
 *      проиндексирует, не спросив. Корзина в выдаче — ровно этот случай.
 *
 * Ходит по `out/`, браузера не требует, идёт секунду. Место — сразу после
 * `build:site`, в том числе в CI.
 *
 *   npm run build:site && node tools/check-urls.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { all } from './routes.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'out')

if (!existsSync(OUT)) {
  console.error('\n✗ Нет out/. Сначала: npm run build:site')
  process.exit(1)
}

/** Собранные страницы: `out/bg/cart.html` → `/bg/cart`. */
const pages = new Map()
walk(OUT, '')
function walk(dir, url) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name.startsWith('_')) continue
      walk(path, `${url}/${name}`)
    } else if (name.endsWith('.html')) {
      const bare = name === 'index.html' ? (url || '/') : `${url}/${name.slice(0, -5)}`
      pages.set(bare, path)
    }
  }
}

/** Есть ли по адресу что ОТДАТЬ.
 *
 *  Папка не считается, и это поймал обратный ход: убрал
 *  `out/bg/catalog/oils.html` — проверка осталась зелёной. Рядом с каждой
 *  страницей статический экспорт кладёт одноимённую ПАПКУ со служебными
 *  файлами (`__next…txt`), и `existsSync` находил её. Нгинкс по такому
 *  адресу отдаст не страницу: `index.html` внутри нет.
 *
 *  Сторож, не проверенный обратным ходом, не отличается от комментария. */
const exists = (url) => {
  const bare = url.replace(/\/+$/, '') || '/'
  if (pages.has(bare) || pages.has(`${bare}/index`)) return true
  const file = join(OUT, bare.slice(1))
  return existsSync(file) && statSync(file).isFile()
}

const SITE = (readFileSync(join(OUT, 'sitemap.xml'), 'utf8')
  .match(/<loc>([^<]*)<\/loc>/)?.[1] ?? '').replace(/\/[^/]*$/, '')
const local = (href) => href.startsWith(SITE) ? href.slice(SITE.length) || '/' : null

/* ── карта сайта ────────────────────────────────────────────────────────── */
const map = readFileSync(join(OUT, 'sitemap.xml'), 'utf8')
const promised = [...map.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])

const broken = []
const seen = new Map()
for (const href of promised) {
  const url = local(href)
  if (url === null) continue
  if (!exists(url)) broken.push(`карта сайта → ${url} — такой страницы нет`)
  seen.set(url, (seen.get(url) ?? 0) + 1)
}
for (const [url, n] of seen) {
  if (n > 1) broken.push(`карта сайта обещает ${url} ${n} раза — двойник`)
}

/* ── ссылки внутри страниц: canonical и hreflang ────────────────────────── */
const silent = []
for (const [url, path] of [...pages].sort()) {
  const html = readFileSync(path, 'utf8')
  for (const m of html.matchAll(/<link rel="(canonical|alternate)"[^>]*href="([^"]+)"/g)) {
    const to = local(m[2])
    if (to !== null && !exists(to)) {
      broken.push(`${url} → ${m[1]} ${to} — такой страницы нет`)
    }
  }

  /* Открытое обещано. Служебные листы самого фреймворка (`_not-found`,
     `404`) адресами не являются — их отдаёт нгинкс по коду ответа. */
  if (/^\/(404|_not-found)$/.test(url)) continue
  if (seen.has(url)) continue
  if (/<meta name="robots"[^>]*noindex/i.test(html)) continue
  silent.push(url)
}

let failed = false
if (broken.length) {
  failed = true
  console.error(`\n✗ Обещан адрес, которого нет: ${broken.length}`)
  for (const b of broken.slice(0, 20)) console.error(`    ${b}`)
  if (broken.length > 20) console.error(`    …и ещё ${broken.length - 20}`)
  console.error('\n  Указать на адрес, которого нет, хуже, чем не указать ни на что.')
}
if (silent.length) {
  failed = true
  console.error(`\n✗ Страница ни в карте сайта, ни с noindex: ${silent.length}`)
  for (const s of silent) console.error(`    ${s}`)
  console.error('\n  Молчание не убирает страницу из выдачи. Либо в карту, либо')
  console.error("  сказать о себе: `robots: { index: false }` в метаданных страницы.")
}
if (failed) process.exit(1)

console.log(`· адреса сходятся: обещано ${seen.size}, собрано ${pages.size}, мёртвых ссылок нет`)
