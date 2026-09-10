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

/* Предметы, которые тёмны замыслом и лежат НАД страницей, а не на её полу:
   нижняя панель, всплывающее сообщение, кружок помощника. Им фирменная
   заливка положена — белеть на палубе они не должны, они её закрывают. */
const FLOATING = [
  'components/TabBar.module.css',
  'components/Toast.module.css',
  'components/Helper.module.css',
]

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

const found = { fontPx: [], spacingPx: [], breakpoint: [], ratioNoCap: [], halfRole: [], nearStep: [], motion: [] }

/* Комментарий — не код. Объяснение, ПОЧЕМУ брейкпоинт убран, само считалось
   брейкпоинтом; абзац про `padding-block: var(--sp-9)` — отступом. Режется с
   сохранением длины, пробел на символ: номера строк считаются по смещению.

   Пробела на символ мало: перенос строки внутри комментария тоже становился
   пробелом, комментарий схлопывался в одну строку, и ВСЕ номера ниже него
   уезжали вверх. Сохраняются и длина, и переносы.

   Второй проход резал комментарии, а первый — нет, и правка легла мимо.
   Признак тот же, что всегда: адрес не сходится с тем, что видно глазом. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/* Управляющий байт в файле стилей — не мелочь и не косметика.
 *
 * По правилам CSS нулевой байт внутри объявления делает его недействительным:
 * браузер выбрасывает СТРОКУ ЦЕЛИКОМ и молчит. Так у кнопки выхода пропало
 * `padding` — надпись встала впритык к краю, и выглядело это как «кнопка не
 * подстраивается под текст». Шесть таких байтов попали в файл правкой
 * скриптом; ни один инструмент об этом не сказал.
 *
 * Проверка валит сборку сразу, а не считает храповиком: это не долг, который
 * чинят в своём темпе, а испорченный файл. */
const dirty = []
for (const path of files) {
  const raw = readFileSync(path)
  const bad = [...raw].filter((b) => b < 9 || (b > 13 && b < 32)).length
  if (bad) dirty.push(`${relative(ROOT, path)}: ${bad}`)
}
if (dirty.length) {
  /* Все сразу, а не первый попавшийся: испорчен обычно не один файл — их
     портит одна и та же неудачная правка скриптом. */
  console.error('\n✗ Управляющие байты в файлах стилей:')
  for (const d of dirty) console.error(`    ${d}`)
  console.error('\n  Браузер выбросит объявления, в которых они стоят, и не скажет об этом.')
  console.error('  Починить все:')
  console.error("    node -e \"const fs=require('fs');for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);fs.writeFileSync(f,Buffer.from([...b].filter(c=>c>=32||[9,10,13].includes(c))))}\" " + dirty.map((d) => d.split(':')[0]).join(' '))
  process.exit(1)
}

for (const path of files) {
  const rel = relative(ROOT, path)
  if (EXEMPT.includes(rel)) continue
  const css = strip(readFileSync(path, 'utf8'))
  const at = (index) => `${rel}:${css.slice(0, index).split('\n').length}`

  /* Одно объявление — одна находка. `padding:20px 26px 8px` — это три числа,
     но ОДНО место, которое чинится одной правкой. Считая числа, проверка
     показывала 60 там, где мест было втрое меньше, и долг выглядел страшнее,
     чем есть. Долг мерится работой, а не арифметикой. */
  const seen = new Set()
  const add = (fam, line) => {
    if (seen.has(fam + line)) return
    seen.add(fam + line)
    found[fam].push(line)
  }

  for (const m of css.matchAll(/font-size:\s*([\d.]+)px/g)) {
    add('fontPx', `${at(m.index)}  font-size:${m[1]}px`)
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
  /* Пилюля — контрол и тогда, когда высоты у неё в файле нет: высоту ей
     ДАЁТ подкладка вместе со строкой текста. Признак собственного размера
     её не ловил, и `padding:9px 13px` у ссылки в меню считался ритмом —
     а это её устройство, то самое, где доля растёт вместе с высотой.
     Скруглением в половину высоты ничто, кроме контрола, не бывает. */
  const IS_PILL = /border-radius\s*:\s*var\(--r-pill\)/
  for (const m of css.matchAll(/(?<![-a-z])(padding|margin|gap|inset)[a-z-]*:\s*([^;}]+)/g)) {
    /* блок, внутри которого стоит объявление */
    const open = css.lastIndexOf('{', m.index)
    const close = css.indexOf('}', m.index)
    const block = open >= 0 && close > open ? css.slice(open, close) : ''
    const geometry = m[1] !== 'margin' && (OWN_SIZE.test(block) || IS_PILL.test(block))
    if (geometry) continue
    /* Запасное значение переменной — не выбор отступа: в
       `padding:calc(var(--qty-h,54px) * .074)` число 54 это высота контрола,
       объявленная где-то ещё, а здесь лишь названная на случай, если её не
       назначили. Считать его нарушением значит требовать шкалу от того, что
       шкалой не является. */
    /* `clamp(var(--sp-8), 4.62vw - 9.85px, var(--sp-9))` — это ступень
       между двумя ступенями, текущая с шириной: ровно то, чего правило и
       требует. Число внутри — наклон прямой, а не отступ. Признак: в
       значении есть и `vw`, и шкала. */
    if (/vw/.test(m[2]) && /var\(--sp-/.test(m[2])) continue
    const bare = m[2].replace(/var\([^()]*\)/g, '')
    for (const px of bare.matchAll(/(\d+(?:\.\d+)?)px/g)) {
      if (Number(px[1]) >= SPACING_FLOOR) {
        add('spacingPx', `${at(m.index)}  ${m[0].trim().slice(0, 48)}`)
      }
    }
  }

  /* Роль переопределяется ПАРОЙ.

     Тёмная палуба переопределяла только цвет знака (`--sage-12` → белый), а
     `--surface` оставался белым листом: пилюли героя вышли белым по белому,
     слов не видно вовсе. Заказчик нашёл это глазом на витрине.

     Сломалась бы любая плашка внутри палубы, а не только пилюли: знак и то,
     на чём он стоит, — одна пара, и переопределять её половиной нельзя.
     Проверка смотрит ровно это: блок, назначающий цвет знака, обязан в том
     же блоке назначить и поверхность. `:root` не в счёт — там объявлено всё.

     Отрисованной проверкой это не ловится: она открывает витрину в одном
     состоянии настроек, а палуба — одно из многих. Признак виден в файле,
     значит место ему здесь. */
  for (const m of css.matchAll(/(?:^|[;{])\s*--sage-1[12]\s*:/g)) {
    const open = css.lastIndexOf('{', m.index)
    const close = css.indexOf('}', m.index)
    if (open < 0 || close < open) continue
    const head = css.slice(Math.max(0, css.lastIndexOf('}', open) + 1), open)
    if (/:root/.test(head)) continue
    const block = css.slice(open, close)
    if (/--surface\s*:/.test(block)) continue
    add('halfRole', `${at(m.index)}  ${head.trim().slice(0, 44)} — знак переопределён, поверхность нет`)
  }

  /* Та же пара, сломанная с другой стороны: фон записан ЛИТЕРАЛОМ, а краска
     взята токеном, который зависит от фона раздела.

     Стрелка героя на наведении: `background:#fff; color:var(--sage-12)`. На
     тёмной палубе `--sage-12` становится белым — и знак пропадает на белом
     кружке. Заказчик снова нашёл это глазом, уже второй раз в тот же день:
     первый был у пилюль, и починен был только он. Дефект чинится во всех
     местах сразу, а не там, где показали, — потому и проверка. */
  for (const m of css.matchAll(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|white)\s*[;}]/g)) {
    const open = css.lastIndexOf('{', m.index)
    const close = css.indexOf('}', m.index)
    if (open < 0 || close < open) continue
    const block = css.slice(open, close)
    const ink = block.match(/(?:^|[;{])\s*color\s*:\s*var\(--(sage-1[12]|chrome-fg[a-z0-9-]*)\)/)
    if (!ink) continue
    const head = css.slice(Math.max(0, css.lastIndexOf('}', open) + 1), open)
    add('halfRole', `${at(m.index)}  ${head.trim().slice(0, 40)} — фон литералом, краска токеном --${ink[1]}`)
  }

  /* Та же пара, сломанная с третьей стороны, и это тот же день и тот же
     глаз заказчика: состояние контрола покрашено ФИРМЕННЫМ цветом.

     `--accent-solid` — не только цвет кнопки, это ещё и цвет тёмного пола:
     `--page-deck: var(--chrome-bg)`, а `--chrome-bg` и `--accent-solid` —
     один и тот же `#0C3A46`. Пилюля героя на палубе под указателем красилась
     В ЦВЕТ ПАЛУБЫ и исчезала целиком вместе со словом. Так же исчезла бы
     любая основная кнопка, любой выбранный пункт, любая нажатая плитка,
     попади они на палубу или на лист подвала.

     Поэтому у состояния теперь своя роль — `--pop` / `--on-pop` /
     `--pop-hover`, — и тёмный пол переопределяет её парой вместе с
     `--surface`. Фирменный цвет остаётся только там, где предмет тёмен
     ЗАМЫСЛОМ и лежит НАД страницей: нижняя панель, всплывающее сообщение,
     кружок помощника. Они пол закрывают, а не стоят на нём. */
  if (!FLOATING.includes(rel)) {
    for (const m of css.matchAll(/background(?:-color)?\s*:\s*var\(--(accent-solid|hover-solid)\)/g)) {
      const open = css.lastIndexOf('{', m.index)
      const head = open < 0 ? '' : css.slice(Math.max(0, css.lastIndexOf('}', open) + 1), open)
      add('halfRole', `${at(m.index)}  ${head.trim().slice(0, 40)} — состояние фирменным цветом (нужен --pop)`)
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
      add('breakpoint', `${at(m.index)}  ${m[0]}`)
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
      add('ratioNoCap', `${at(m.index)}  aspect-ratio без потолка`)
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
  const css = strip(readFileSync(file, 'utf8'))
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

/* Ступени, которые глаз не различает.
 *
 * Шкала размера была: 11 · 12.5 · 13 · 14 · 15 · 16 · 18 · 22 · 26. Четыре
 * соседние пары отличались на 4–7% — это не две роли, а одна, записанная
 * дважды. Роль, неотличимая от соседней, не работает: подпись под карточкой
 * и текст в ней читаются как одно, и выбирать между ними приходится наугад.
 *
 * Порог 8% взят снизу: ниже него разница в 13 и 14 пикселей не видна никому,
 * включая того, кто её ставил. Шкалы, на которые ссылаются пособия (Material,
 * модульные лестницы), шагают на 12–25%.
 *
 * Мерятся ОБА конца clamp: шкала течёт, и сойтись ступени могут на любом.
 */
const LADDER = join(ROOT, 'styles/tokens.css')
if (existsSync(LADDER)) {
  const css = strip(readFileSync(LADDER, 'utf8'))
  const steps = []
  for (const m of css.matchAll(/--fs-([a-z0-9]+)\s*:\s*clamp\(\s*([\d.]+)px[^,]*,[^,]*,\s*([\d.]+)px\s*\)/g)) {
    steps.push({ name: m[1], min: Number(m[2]), max: Number(m[3]) })
  }
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], b = steps[i]
    for (const end of ['min', 'max']) {
      const ratio = b[end] / a[end]
      if (ratio > 1 && ratio < 1.08) {
        found.nearStep.push(
          `styles/tokens.css  --fs-${a.name} → --fs-${b.name}: ${a[end]} → ${b[end]}px ` +
          `(${Math.round((ratio - 1) * 100)}%, ${end === 'min' ? 'узкий' : 'широкий'} конец)`)
      }
    }
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
  halfRole: 'роль переопределена наполовину: знак сменили, поверхность нет',
  nearStep: 'соседние ступени шкалы ближе 8% — глаз их не различает',
  motion: 'движение: двигает раскладку, дольше 500ms или ease-in',
}

/* `--list [семья]` печатает сами находки. Без него долг видно числом, но
   не видно местом: 60 отступов — это не адрес, а настроение. Платить долг
   вслепую нельзя, а прошлые сессии именно этим и занимались. */
const li = process.argv.indexOf('--list')
if (li !== -1) {
  const pick = process.argv[li + 1]
  const fams = found[pick] ? [pick] : Object.keys(NAMES)
  for (const k of fams) {
    console.log(`\n${NAMES[k]} — ${found[k].length}`)
    for (const line of found[k]) console.log(`    ${line}`)
  }
  process.exit(0)
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
