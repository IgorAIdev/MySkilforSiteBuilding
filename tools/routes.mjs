/**
 * Список адресов, которые публикует сайт, — из дерева маршрутов и данных.
 *
 * Заведён по дефекту, и дефект был молчаливый. В отрисованной проверке
 * список страниц стоял рукой:
 *
 *     const PAGES = ['/bg', '/bg/catalog', '/bg/product/zelenika-15',
 *                    '/bg/cart', '/bg/checkout']
 *
 * А в дереве маршрутов их семь форм и два языка. Полка категории
 * (`/bg/catalog/oils`) и страница «не найдено» не мерились НИ РАЗУ — ни на
 * контраст, ни на цель нажатия, ни на меру строки. Английская половина
 * сайта — тоже ни разу, при том что дефект «81 знак в строке» записан в
 * скилле именно из английского текста в болгарской коробке.
 *
 * Список, набранный рукой, хуже неполного: он не растёт вообще. Заведённая
 * завтра страница попадёт под проверку тогда, когда о ней вспомнят, — то
 * есть после того, как заказчик найдёт на ней дефект глазом.
 *
 * Поэтому список задаёт ДЕРЕВО, а значения динамических сегментов — ДАННЫЕ.
 * Новая страница попадает под проверку в день, когда её завели.
 *
 *     import { all, sample } from './routes.mjs'
 *     all()      // каждый адрес: 108 штук, для дешёвых проверок
 *     sample()   // по одному на форму маршрута и язык, для дорогих
 *
 * Данные читаются РАЗБОРОМ ИСХОДНИКА, а не импортом: `lib/products.ts` —
 * это TypeScript, и ради списка категорий поднимать сборщик незачем.
 * Признак поломки разбора — пустой список; поэтому пустой список валит
 * проверку, а не проходит тихо (см. `assertData`).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
/* Файла может не быть вовсе: набор переезжает в новый проект, где `lib/`
   ещё пуст. Пустая строка тут значит «данных нет», и это не поломка — а вот
   данные, которые ЕСТЬ и не разобрались, поломка (см. ниже). */
const src = (p) => existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : ''

const locale = src('lib/locale.ts')
const catalogue = src('lib/products.ts')

/** Языки. Язык — это адрес: `/bg/...` и `/en/...`, по маршруту на язык. */
export const LOCALES = [...(locale.match(/LOCALES\s*=\s*\[([^\]]*)\]/)?.[1] ?? '')
  .matchAll(/'([a-z-]+)'/g)].map((m) => m[1])

export const DEFAULT_LANG =
  locale.match(/DEFAULT_LANG[^=]*=\s*'([a-z-]+)'/)?.[1] ?? LOCALES[0]

/** Полки. Порядок тот же, что в данных: он по спросу, и первая полка — самая
 *  полная. */
export const CATEGORIES = [...catalogue.matchAll(/\{\s*slug:\s*'([a-z-]+)'/g)]
  .map((m) => m[1])

/** Товары. Нужны три поля: адрес, полка и семья вариантов — по ним
 *  выбираются образцы для дорогих проверок. */
export const PRODUCTS = [...catalogue.matchAll(/^ *\{ id:'([^']+)'(.*)$/gm)]
  .map((m) => ({
    id: m[1],
    cat: m[2].match(/cat:'([a-z-]+)'/)?.[1] ?? '',
    family: m[2].match(/family:'([^']+)'/)?.[1] ?? '',
  }))

/** Есть файл, а данных из него не вышло — это сломанный разбор, а не пустой
 *  магазин. Молчаливо неполный замер выглядит как результат: ровно так три
 *  страницы из пяти не мерились вовсе и проверка была зелёной.
 *
 *  Отсутствующий файл — другое дело: в новом проекте `lib/` пуст, и требовать
 *  от него сорок товаров значит не дать набору завестись. */
export function assertData() {
  const empty = [
    ['LOCALES', locale, LOCALES], ['CATEGORIES', catalogue, CATEGORIES],
    ['PRODUCTS', catalogue, PRODUCTS],
  ].filter(([, file, v]) => file && !v.length).map(([n]) => n)
  if (empty.length) {
    console.error(`\n✗ tools/routes.mjs: разбор данных дал пусто — ${empty.join(', ')}.`)
    console.error('  Изменилась запись в lib/. Список адресов сейчас неполон, и любая')
    console.error('  проверка на нём зелёная по той же причине, по какой пуста.')
    process.exit(1)
  }
}

/** Язык магазина — тот, на котором его читают. Языков нет вовсе (нет
 *  сегмента `[lang]`) — родным считается всё: иначе проходы, идущие «по
 *  родному языку», молча не пошли бы никуда. */
export const isNative = (url) =>
  !LOCALES.length || url.split('/')[1] === DEFAULT_LANG

/** Формы маршрутов из дерева `app/**\/page.tsx`: `/[lang]`, `/[lang]/catalog`,
 *  `/[lang]/catalog/[cat]`, … Группы `(x)`, приватные `_x` и параллельные
 *  `@x` папки адреса не дают и отбрасываются. */
export function shapes() {
  const out = []
  walk(join(ROOT, 'app'), '')
  function walk(dir, url) {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (name.startsWith('_') || name.startsWith('@')) continue
        walk(path, /^\(.*\)$/.test(name) ? url : `${url}/${name}`)
      } else if (/^page\.(tsx|ts|jsx|js)$/.test(name)) {
        out.push(url || '/')
      }
    }
  }
  return out.sort()
}

/** Чем заполняются динамические сегменты. Ключ — сегмент, как он записан в
 *  дереве; значение — все существующие величины. */
const FILL = {
  '[lang]': () => LOCALES,
  '[cat]': () => CATEGORIES,
  '[id]': () => PRODUCTS.map((p) => p.id),
}

/** Образцы для дорогих проверок: не «первое попавшееся», а два конца.
 *
 *  Полка: самая полная и самая пустая. Тринадцать товаров и два — это две
 *  разные раскладки одной сетки, и ломается всегда вторая: `auto-fit` при
 *  двух карточках растягивает их во всю строку.
 *
 *  Товар: с самой большой семьёй вариантов (там есть селектор крепости,
 *  отчёт лаборатории и полка «сравните с») и без семьи вовсе — на одиночном
 *  товаре половины страницы нет, и её отсутствие тоже вёрстка. */
const SAMPLE = {
  '[lang]': () => LOCALES,
  '[cat]': () => {
    const size = (c) => PRODUCTS.filter((p) => p.cat === c).length
    const sorted = [...CATEGORIES].sort((a, b) => size(b) - size(a))
    return [...new Set([sorted[0], sorted[sorted.length - 1]])].filter(Boolean)
  },
  '[id]': () => {
    const count = {}
    for (const p of PRODUCTS) if (p.family) count[p.family] = (count[p.family] ?? 0) + 1
    const biggest = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0]
    const pick = [
      PRODUCTS.find((p) => p.family === biggest)?.id,
      PRODUCTS.find((p) => !p.family)?.id,
    ]
    return [...new Set(pick.filter(Boolean))]
  },
}

const expand = (fill) => (url) => {
  let rows = ['']
  for (const seg of url.split('/').filter(Boolean)) {
    const dynamic = /^\[.*\]$/.test(seg)
    const values = fill[seg] ? fill[seg]() : dynamic ? [] : [seg]
    /* Сегмент, который нечем подставить, — это НЕ пустой список адресов.
       Промолчав, проверка выбросила бы из обхода целую ветку дерева и
       осталась бы зелёной: ровно тот молчаливо неполный замер, ради
       которого весь этот файл и написан. */
    if (!values.length) {
      console.error(`\n✗ tools/routes.mjs: сегмент ${seg} в маршруте ${url} нечем подставить.`)
      console.error('  Научите FILL/SAMPLE, откуда брать его значения, — иначе эта ветка')
      console.error('  дерева не проверяется вовсе, а проверка выглядит зелёной.')
      process.exit(1)
    }
    rows = rows.flatMap((prefix) => values.map((v) => `${prefix}/${v}`))
  }
  return rows.length ? rows : ['/']
}

/** Каждый адрес, который публикует сайт. Для дешёвых проверок: открывается
 *  ли страница, обещана ли она картой сайта. */
export function all() {
  assertData()
  return [...new Set(shapes().flatMap(expand(FILL)))].sort()
}

/** По одному адресу на форму маршрута и язык. Для дорогих проверок —
 *  отрисованных, где каждая страница стоит шести открытий. */
export function sample() {
  assertData()
  return [...new Set(shapes().flatMap(expand(SAMPLE)))].sort()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = process.argv.includes('--sample') ? sample() : all()
  for (const url of list) console.log(url)
  console.error(`\n${list.length} адресов, форм маршрута ${shapes().length}`)
}
