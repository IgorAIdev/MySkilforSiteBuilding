/**
 * Храповик по вёрстке.
 *
 * Проверяет четыре запрета из CLAUDE.md — размер шрифта в пикселях, отступ
 * в пикселях, брейкпоинт вне разрешённых трёх и пропорцию без потолка, —
 * плюс движение, и сравнивает счётчики с базой в tools/css-baseline.json.
 *
 * Падает, только если нарушений стало БОЛЬШЕ. Накопленное чинится в своём
 * темпе, новое не заводится. Проверка, которая падает с первого дня, живёт
 * ровно до первого «давай пока отключим».
 *
 *   node tools/check-css.mjs              проверить
 *   node tools/check-css.mjs --update     записать текущие числа как базу
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const DIRS = ['app', 'components', 'styles']
const BASELINE = join(ROOT, 'tools/css-baseline.json')

/* Шкала объявляется в пикселях внутри clamp() — это её работа, а не
   нарушение. Панель настроек рисует саму себя и в магазин не едет. */
const EXEMPT = ['styles/tokens.css', 'styles/studio.module.css']

/** Разрешённые точки: смена смысла раскладки, а не размера. */
const BREAKPOINTS = [1080, 820, 560]

/* Меньше 8px — оптическая доводка под скруглением штриха, а не ритм: шкалой
   такое не описывается, и запрещать его смысла нет. */
const SPACING_FLOOR = 8

const files = []
for (const dir of DIRS) walk(join(ROOT, dir))
function walk(dir) {
  /* Папки может не быть вовсе — на новом проекте `app/` или `components/`
     появляются не в первый день. Проверка, падающая на пустом проекте, до
     первого дня и не доживает. */
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (name.endsWith('.css')) files.push(path)
  }
}

const found = { fontPx: [], spacingPx: [], breakpoint: [], ratioNoCap: [], motion: [] }

for (const path of files) {
  const rel = relative(ROOT, path)
  if (EXEMPT.includes(rel)) continue
  const css = readFileSync(path, 'utf8')
  const at = (index) => `${rel}:${css.slice(0, index).split('\n').length}`

  for (const m of css.matchAll(/font-size:\s*([\d.]+)px/g)) {
    found.fontPx.push(`${at(m.index)}  font-size:${m[1]}px`)
  }

  /* Ритм и геометрия — разные вещи, и правило 2 про первое.
   *
   * Ритм — это расстояния МЕЖДУ вещами: воздух между разделами, просвет
   * между карточками, отбивка заголовка. Он обязан течь со шкалой, потому
   * что 64px между разделами на десктопе — воздух, а на телефоне треть
   * экрана.
   *
   * Геометрия контрола — это его собственное устройство: поле внутри
   * пилюли, просвет до иконки. Оно не течёт и течь не должно: пилюля
   * высотой 28px не становится 34px на широком мониторе.
   *
   * Больше того, эти числа не произвольны. Поле внутри пилюли — доля её
   * высоты, и доля растёт вместе с высотой: 0.385 при 26px, 0.478 при 46,
   * 0.519 при 54. Это оптика, а не неряшливость: у мелкой пилюли плечо
   * ограничено снизу боковыми пробелами самого шрифта. Загнать их в одну
   * ступень — испортить, а не собрать.
   *
   * Отличаются они по признаку, который виден в файле: у контрола в том же
   * блоке назначен СВОЙ размер — `height` или `width` числом. Правило,
   * которое задаёт себе высоту и поле внутри, описывает предмет. Правило,
   * которое задаёт только отступ, описывает расстояние.
   *
   * `margin` из послабления исключён всегда: это расстояние до соседа, то
   * есть ритм, даже когда стоит на контроле.
   *
   * `(?<![-a-z])` отсекает объявление собственной переменной: в
   * `--grid-gap:14px` иначе находится `gap:14px`, и шкала, ради которой
   * всё затевалось, считалась бы нарушением правила о шкале. */
  const OWN_SIZE = /(?:^|[;{])\s*(?:min-|max-)?(?:height|width|block-size|inline-size)\s*:\s*\d+(?:\.\d+)?px/
  for (const m of css.matchAll(/(?<![-a-z])(padding|margin|gap|inset)[a-z-]*:\s*([^;}]+)/g)) {
    /* блок, внутри которого стоит объявление */
    const open = css.lastIndexOf('{', m.index)
    const close = css.indexOf('}', m.index)
    const block = open >= 0 && close > open ? css.slice(open, close) : ''
    const geometry = m[1] !== 'margin' && OWN_SIZE.test(block)
    if (geometry) continue
    /* Запасное значение переменной — не выбор отступа: в
       `padding:calc(var(--qty-h,54px) * .074)` число 54 это высота контрола,
       объявленная где-то ещё, а здесь лишь названная на случай, если её не
       назначили. Считать его нарушением значит требовать шкалу от того, что
       шкалой не является. */
    const bare = m[2].replace(/var\([^()]*\)/g, '')
    for (const px of bare.matchAll(/(\d+(?:\.\d+)?)px/g)) {
      if (Number(px[1]) >= SPACING_FLOOR) {
        found.spacingPx.push(`${at(m.index)}  ${m[0].trim().slice(0, 48)}`)
      }
    }
  }

  /* `@container` — не брейкпоинт. Контейнерный запрос меряет ширину своего
     родителя, а не окна: это ровно то, к чему правило 6 и призывает, и
     запрещать его числами разрешённых точек — запрещать правильное.
     Карточка товара мерит себя на 260 и 212 — столько она и бывает в рельсе,
     к раскладке страницы эти числа отношения не имеют. */
  const inContainer = (i) => {
    const at = css.lastIndexOf('@', i)
    return at >= 0 && css.slice(at, at + 10).startsWith('@container')
  }
  for (const m of css.matchAll(/\((?:min|max)-width:\s*(\d+)px\)/g)) {
    if (inContainer(m.index)) continue
    const w = Number(m[1])
    /* Ниже 200px — не про раскладку страницы: так меряют собственную ширину
       контейнера в @container. */
    if (w >= 200 && !BREAKPOINTS.includes(w) && !BREAKPOINTS.includes(w - 1)) {
      found.breakpoint.push(`${at(m.index)}  ${m[0]}`)
    }
  }

  /* Пропорция без потолка: ищем блок, в котором есть aspect-ratio, и
     смотрим, есть ли в нём же ограничение высоты. */
  for (const m of css.matchAll(/aspect-ratio:/g)) {
    const open = css.lastIndexOf('{', m.index)
    let depth = 1, i = open + 1
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    const block = css.slice(open, i)
    /* Пропорция, заданная от высоты (`height:100%; aspect-ratio:1` — кружок
       в строке, который берёт её высоту и считает ширину), потолка по высоте
       не требует: высоту ей уже назначили. Правило про обратный случай —
       когда высота вычисляется из ширины и потому ничем не ограничена. */
    const byHeight = /(?:^|[;{])\s*(?:height|block-size)\s*:/.test(block)

    /* Потолок мог быть назначен ТОМУ ЖЕ селектору в основном правиле, а
       медиазапрос — менять только пропорцию. Тогда потолок никуда не делся,
       и требовать его второй раз значит требовать дубликат.

       Ровно так стояли плитки категорий и поводов: `aspect-ratio:.87;
       max-block-size:min(64svh,460px)` в основном правиле и
       `aspect-ratio:1.2` под 560. Проверка видела второе правило и не видела
       первого. */
    const cut = Math.max(css.lastIndexOf('}', open - 1), css.lastIndexOf('{', open - 1))
    const sel = css.slice(cut + 1, open)
      .replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const capped = sel && new RegExp(
      sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*?(?:max-block-size|max-height)'
    ).test(css)

    if (!byHeight && !capped && !/max-block-size|max-height/.test(block)) {
      found.ratioNoCap.push(`${at(m.index)}  aspect-ratio без потолка`)
    }
  }
}

/* ── движение ──────────────────────────────────────────────────────────────
   Вытащено из открытого набора Emil Kowalski (MIT) — из того, что можно
   померить, а не из того, что надо чувствовать. Ощущение остаётся его
   работой; здесь только два факта, которые проверяются чтением файла.

   ПЕРВОЕ: анимировать можно `transform` и `opacity`. Они пропускают
   раскладку и отрисовку и считаются видеокартой. `width`, `height`, `top`,
   `left`, `padding`, `margin` запускают все три шага заново — и запускают
   их шестьдесят раз в секунду, на каждом кадре. На телефоне это видно
   глазом, а на карточке товара, где такая анимация повторена восемьдесят
   шесть раз, видно и на мониторе.

   Ширина, едущая по `transition`, — самый частый случай в этом коде: так
   раскрывается поле поиска. Починка не в том, чтобы убрать движение, а в
   том, чтобы двигать `transform: scaleX()` или `clip-path`.

   ВТОРОЕ: движение интерфейса живёт меньше 500ms. Его собственная таблица:
   нажатие 100–160, подсказка 125–200, выпадающий список 150–250, окно и
   выдвижная панель 200–500. Дольше — это уже не отклик, а ожидание. */
const LAYOUT_PROPS = /(?:^|[\s,])(width|height|top|left|right|bottom|margin|padding|inset|block-size|inline-size|font-size|border-width)[a-z-]*(?=[\s,]|$)/

for (const file of files) {
  /* Комментарии вырезаются, но длину сохраняем: номера строк считаются по
     смещению, и если текст просто убрать, все они уедут. Пробел вместо
     каждого символа — и номера прежние, и прозы для проверки нет.

     Заведено потому, что проверка читала СОБСТВЕННЫЙ комментарий: строка
     «Стояло `@media (min-width:1241px)`», объясняющая, почему брейкпоинта
     больше нет, считалась брейкпоинтом. */
  const css = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  const rel = relative(ROOT, file)
  if (EXEMPT.includes(rel)) continue
  const at = (i) => `${rel}:${css.slice(0, i).split('\n').length}`

  for (const m of css.matchAll(/(?<![-a-z])transition(?:-property)?\s*:\s*([^;}]+)/g)) {
    const value = m[1]
    /* по частям: `transition: width .45s ease, background .2s ease` */
    for (const part of value.split(',')) {
      if (LAYOUT_PROPS.test(part) && !/var\(/.test(part.split(/\s+/)[0] || '')) {
        found.motion.push(`${at(m.index)}  двигает раскладку: ${part.trim().slice(0, 44)}`)
      }
    }
    for (const d of value.matchAll(/([0-9.]+)(m?s)/g)) {
      const ms = d[2] === 's' ? Number(d[1]) * 1000 : Number(d[1])
      if (ms > 500) found.motion.push(`${at(m.index)}  дольше 500ms: ${d[0]}`)
    }
  }
  for (const m of css.matchAll(/animation\s*:\s*([^;}]+)/g)) {
    for (const d of m[1].matchAll(/([0-9.]+)(m?s)/g)) {
      const ms = d[2] === 's' ? Number(d[1]) * 1000 : Number(d[1])
      /* Показ слайдера живёт секундами по делу — это не отклик, а пауза
         между кадрами, и приходит она переменной. Числом в файле дольше
         полусекунды бывает только анимация интерфейса. */
      if (ms > 500 && !/var\(/.test(m[1])) found.motion.push(`${at(m.index)}  дольше 500ms: ${d[0]}`)
    }
  }
  /* `ease-in` начинается медленно — ровно в тот момент, на который смотрит
     человек. `ease-out` в 200ms ОЩУЩАЕТСЯ быстрее, чем `ease-in` в 200ms. */
  for (const m of css.matchAll(/(?<![-a-z])(?:transition|animation)[a-z-]*\s*:\s*([^;}]*\bease-in\b(?!-out)[^;}]*)/g)) {
    found.motion.push(`${at(m.index)}  ease-in на интерфейсе: ${m[1].trim().slice(0, 40)}`)
  }
}

const counts = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length]))

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n')
  console.log('База обновлена:', counts)
  process.exit(0)
}

let base
try {
  base = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
  console.error(`Нет ${relative(ROOT, BASELINE)}. Создать: npm run check:css -- --update`)
  process.exit(1)
}

const NAMES = {
  fontPx: 'font-size в px (правило 1: размер из шкалы --fs-*)',
  spacingPx: 'отступ в px (правило 2: ритм из шкалы --sp-*)',
  breakpoint: `брейкпоинт вне ${BREAKPOINTS.join('/')} (правило 3)`,
  ratioNoCap: 'aspect-ratio без max-block-size (правило 4)',
  motion: 'движение: двигает раскладку, дольше 500ms или ease-in',
}

let failed = false
for (const key of Object.keys(NAMES)) {
  const now = counts[key], was = base[key] ?? 0
  if (now > was) {
    failed = true
    console.error(`\n✗ ${NAMES[key]}: было ${was}, стало ${now}`)
    for (const line of found[key].slice(-(now - was) * 3)) console.error(`    ${line}`)
  } else if (now < was) {
    console.log(`✓ ${NAMES[key]}: ${was} → ${now}`)
  } else {
    console.log(`· ${NAMES[key]}: ${now}`)
  }
}

if (failed) {
  console.error('\nНарушений стало больше. Либо чините, либо — если это осознанное')
  console.error('решение — обновляйте базу: npm run check:css -- --update')
  process.exit(1)
}

const total = Object.values(counts).reduce((a, b) => a + b, 0)
const wasTotal = Object.values(base).reduce((a, b) => a + b, 0)
if (total < wasTotal) console.log(`\nДолг сократился: ${wasTotal} → ${total}. Обновите базу.`)
