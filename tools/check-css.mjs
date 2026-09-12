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
import { join, relative, dirname } from 'node:path'
import { CSS_FAMILIES } from './css-families.mjs'

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

/* Список семей — в своём файле: его читает и эта проверка, и сборщик набора,
   который пишет новому проекту пустую базу. Один список, два потребителя. */
const found = Object.fromEntries(CSS_FAMILIES.map((k) => [k, []]))

/* Порядок слоёв ВНУТРИ своего блока — это не спор с другими файлами: 1 и 2 у
   карточки товара говорят «подпись поверх снимка», и о шапке они ничего не
   утверждают. Спор начинается там, где число претендует на место в очереди
   ВСЕЙ страницы.

   Граница — однозначное число. Она не про величину, а про намерение: пока
   слоёв внутри блока меньше десяти, номер читается как «выше соседа», и
   выше него всё равно ничего своего нет. Двузначное число ставят, только
   когда целятся выше чужого — шапки, полосы, затемнения, — а целиться в
   чужое числом и есть запрещённое. */
const LOCAL_LAYER = 9

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

  /* Верхний слой браузера вместо номеров.
   *
   * Номер получает только то, что висит на экране ВСЕГДА: шапка, нижняя
   * полоса, помощник, всплывающее сообщение, ссылка «к содержимому». Их
   * пять, они не открываются, порядок между ними — решение, и у каждого
   * есть имя: `var(--layer-header)`, `var(--layer-tabbar)`, …
   *
   * Всё, что ОТКРЫВАЕТСЯ поверх страницы, номера не получает вовсе: его
   * место в верхнем слое браузера — `<dialog>` с `showModal()` для окон и
   * шторок, атрибут `popover` для меню. Что открыто последним, то и сверху;
   * это правило браузера, и перебить его чужим числом из чужого файла
   * нельзя.
   *
   * Заведено по дефекту соседнего магазина: пилюля сортировки носила
   * `z-index: 71`, чтобы её шторка перекрыла затемнение, — и закрытая
   * пилюля лезла поверх шторки фильтров. Число, поставленное элементу ради
   * его СОДЕРЖИМОГО, ломает страницу всегда, потому что спорить ему
   * приходится с числами, которых автор не видел.
   *
   * Верхний слой уносит с собой целый класс ошибок: Escape, возврат фокуса
   * и затемнение (`::backdrop`) приходят от браузера, и «нажали мимо» через
   * `closest` больше не пишется руками.
   *
   * Запрещать номера, не дав имён, нельзя: правило без реализации хуже
   * отсутствующего. Имена — в `styles/tokens.css`, семья `--layer-*`. */
  for (const m of css.matchAll(/(?<![-a-z])z-index\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim()
    if (/var\(--layer-/.test(v)) continue
    if (/^(auto|inherit|initial|unset|revert)$/.test(v)) continue
    const n = Number(v)
    if (Number.isFinite(n) && Math.abs(n) <= LOCAL_LAYER) continue
    add('zIndex', `${at(m.index)}  z-index:${v} — имя из --layer-* или верхний слой`)
  }

  /* Нажатие обязано отвечать — на телефоне это единственный отклик.
   *
   * Наведение на телефоне не бывает: `@media (hover:hover)` его туда и не
   * пускает, и это правильно. Серую рамку, которую Android рисовал поверх
   * нажатого, мы сняли (`-webkit-tap-highlight-color` в `styles/base.css`):
   * она не знает ни формы предмета, ни его цвета и держится ещё долю
   * секунды после того, как палец ушёл.
   *
   * Снять чужой отклик можно только вместе со своим. Контрол, у которого
   * объявлено `:hover` и не объявлено ничего для нажатого состояния, на
   * телефоне теперь не отвечает ВОВСЕ: наведения нет, рамки нет, своего нет.
   *
   * Отклик засчитывается трёх видов, и все три — видимая перемена в момент
   * нажатия: `:active`, состояние из `aria-` (переключатель показывает
   * собственное новое положение) и состояние из `data-`. */
  const answers = (sel) => {
    if (!sel) return false
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(esc + '(?::active|\\[aria-|\\[data-)').test(css)
  }
  for (const m of css.matchAll(/([.#][^{},@]*?):hover/g)) {
    const raw = m[1].trim()
    if (!raw || raw.startsWith('@')) continue
    /* Спрашивается дважды. Сперва про сам селектор — так найдётся пара
       `.wrap[data-faq='sheet'] .item:hover` / `… .item:active`. Потом про
       него же без состояний: `.sw[aria-checked='true']` — это переключатель
       во включённом положении, а отвечает на нажатие переключатель, и
       отвечает он сменой того самого состояния. */
    if (answers(raw) || answers(raw.replace(/\[[^\]]*\]/g, '').trim())) continue
    add('noPress', `${at(m.index)}  ${raw} — есть :hover, нет отклика на нажатие`)
  }

  /* Приклеенное без потолка от окна. Блок с `position:sticky` и смещением
     от верха — колонка, едущая рядом с содержимым (галерея товара, сводка
     заказа, панель фильтров), — обязан назвать потолок высоты в `dvh`:
     приклеенное выше окна нельзя увидеть целиком никогда, его низ приходит
     только с концом соседа. Заказчик увидел это на ноутбуке: «изображение и
     дополнительные не помещаются в экран». Полосы у самого края (`top:0`
     внутри своей прокрутки, `bottom:`) и слои шапки (`--layer-*`) — не
     колонки, им нечего ограничивать. Потолок может стоять в другом правиле
     того же селектора (в `@container`) — как у пропорции ниже. */
  for (const m of css.matchAll(/position\s*:\s*sticky/g)) {
    const open = css.lastIndexOf('{', m.index)
    let depth = 1, i = open + 1
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    const block = css.slice(open, i)
    if (!/(?:^|[;{\s])top\s*:/.test(block)) continue
    if (/(?:^|[;{\s])top\s*:\s*0(?:px)?\s*[;}]/.test(block)) continue
    if (/z-index\s*:\s*var\(--layer-/.test(block)) continue
    const cut = Math.max(css.lastIndexOf('}', open - 1), css.lastIndexOf('{', open - 1))
    const sel = css.slice(cut + 1, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const capped = sel && new RegExp(
      sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*?dvh'
    ).test(css)
    if (!capped && !/dvh/.test(block)) {
      add('stickyCap', `${at(m.index)}  приклеенное без потолка от окна (dvh)`)
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

  /* ── фокус, убранный и не заменённый ────────────────────────────────────
   *
   * `outline:none` — самый частый способ сломать клавиатуру, и ломает он
   * молча: мышью всё работает, дифф безупречен, а человек, который ходит по
   * сайту табом, теряет место на странице целиком. У покупателя это не
   * редкость: клавиатурой пользуются и те, у кого не работает рука, и те,
   * кому просто быстрее.
   *
   * Убирается ПАРОЙ — ровно как чужая рамка Android у семьи `noPress`: снял
   * кольцо браузера — обязан нарисовать своё. Само по себе `outline:none`
   * не дефект: у нас все три случая законны — `.find input` гасит кольцо у
   * поля, а рисует его рамкой на `.find:focus-within`, и `.sw` переносит
   * кольцо с органа на дорожку внутри него. Дефект — когда замены нет
   * нигде.
   *
   * Спрашивается по ФАЙЛУ, и это не приблизительность: модуль CSS — это один
   * компонент, и если кольцо не нарисовано здесь, его не нарисует никто.
   * Правило из открытого списка Vercel (Web Interface Guidelines), из той
   * его половины, которую можно померить чтением файла. */
  const kills = [...css.matchAll(/outline\s*:\s*(?:none|0)\b|outline-style\s*:\s*none\b|outline-width\s*:\s*0\b/g)]
  if (kills.length) {
    /* Замена — любая краска, назначенная В СОСТОЯНИИ ФОКУСА: своё кольцо,
       тень-кольцо, рамка, фон. Ищем правило, у которого в селекторе есть
       `:focus`, а в теле — чем рисовать. */
    const paints = /(?:^|[;{\s])(outline(?:-color|-width|-style|-offset)?|box-shadow|border(?:-[a-z]+)?|background(?:-color)?|text-decoration[a-z-]*)\s*:/
    let replaced = false
    for (const rule of css.matchAll(/([^{}]*:focus[^{}]*)\{([^}]*)\}/g)) {
      if (!paints.test(rule[2])) continue
      if (/outline\s*:\s*(?:none|0)\b/.test(rule[2]) && !paints.test(rule[2].replace(/outline\s*:\s*(?:none|0)\b/g, ''))) continue
      replaced = true
      break
    }
    if (!replaced) {
      for (const m of kills) found.focusGone.push(`${at(m.index)}  кольцо фокуса снято, замены в файле нет`)
    }
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


/* ── Разметка: числа, которых проверка не видела ──────────────────────────
 *
 * Обход читал только `.css`, и база честно показывала `fontPx: 0`. Ноль в
 * базе значит «в стилях чисто», а читается как «в проекте чисто» — это
 * ровно тот молчаливо неполный замер, который выглядит как результат.
 *
 * Долг лежал в разметке: `fontSize: 38` на странице «не найдено`,
 * `fontSize: 17`, `padding: '96px 0 120px'`, `marginTop: 28` — десять мест
 * в пяти файлах. Инлайновый стиль вдобавок СИЛЬНЕЕ любого правила в файле
 * стилей: число в разметке накрывает кривую clamp() и отменяет всю
 * текучесть, которую шкала обеспечивает.
 *
 * Панель настроек рисует саму себя и в магазин не едет — её числа не считаются.
 */
const CODE = []
for (const dir of DIRS) walkCode(join(ROOT, dir))
function walkCode(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walkCode(path)
    else if (/\.tsx?$/.test(name)) CODE.push(path)
  }
}

for (const path of CODE) {
  const rel = relative(ROOT, path)
  if (rel.includes('studio')) continue
  const code = strip(readFileSync(path, 'utf8').replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length)))
  const at = (index) => `${rel}:${code.slice(0, index).split('\n').length}`
  const seen = new Set()
  const add = (line) => { if (!seen.has(line)) { seen.add(line); found.inlinePx.push(line) } }

  for (const m of code.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    const body = m[1]
    const where = at(m.index)

    /* Пользовательское свойство — механизм, а не размер: через него в
       вёрстку уезжает то, что известно только в браузере (сдвиг пальца,
       ширина панели). Шкалой такое не описывается. */
    const own = body.replace(/\['--[^\]]*'[^,]*,?/g, '')

    if (/\bfontSize:\s*['"]?[\d.]+/.test(own)) add(`${where} (размер)`)

    for (const d of own.matchAll(/\b(padding|margin|gap|inset|top|left|right|bottom|width|height|maxWidth|minHeight)[A-Za-z]*:\s*(['"][^'"]*['"]|[\d.]+)/g)) {
      /* Меньше 8px — оптическая доводка, шкалой не описывается (как и в
         стилях). Считаются числа, а не выражения: `${pull}px` — величина,
         вычисленная в браузере, и ступени у неё быть не может. */
      const nums = [...String(d[2]).matchAll(/([\d.]+)px|^\s*([\d.]+)\s*$/g)]
        .map((x) => Number(x[1] ?? x[2])).filter((n) => Number.isFinite(n))
      if (nums.some((n) => n >= SPACING_FLOOR)) add(`${where} (ритм)`)
    }
  }
}

/* ── Две правды об одном факте ────────────────────────────────────────────
 *
 * Цена, оценка, партия и состав товара живут в `lib/`. Набранные ВТОРОЙ раз
 * в компоненте, они расходятся — и расходятся молча, потому что оба числа
 * выглядят правдоподобно.
 *
 * Заведено по счёту, и счёт был €30. Таблица крепостей на странице товара
 * держала `{ id: 'zelenika-30', price: 54.00, cbd: 2000 }`, а в каталоге
 * `zelenika-30` — это 30%, 3000 мг и €84. Кнопка показывала €54 и клала в
 * корзину товар за €84. В диффе обе строки безупречны.
 *
 * Признак, видимый в файле: в одном месте стоят и идентификатор товара, и
 * его факт. Значит факт набран рукой там, где его надо было спросить.
 *
 * Это НЕ храповик и не долг: разошедшиеся цены — не то, что чинят в своём
 * темпе. Как и управляющий байт, валит сборку сразу.
 */
/**
 * Набор стилей, прочитанный через клиентский компонент.
 *
 * `export { s as cardStyles }` в файле с 'use client' и `cardStyles.grid` в
 * серверной странице — это `undefined`. Сборка молчит, `tsc` молчит: для
 * серверного файла экспорт клиентского модуля не значение, а ссылка на
 * клиента, и свойство у неё пустое. В разметку уезжает `<div>` без класса, и
 * раскладки просто нет.
 *
 * Заведено по счёту, и счёт был велик. Полка «сравните с» на всех сорока
 * страницах товара стояла БЕЗ сетки — карточки шли столбиком во всю ширину.
 * Раздел отчёта тем же способом терял свои две колонки: текст обещал «анализ
 * справа», а таблица всё это время была снизу. Оба дефекта уехали на прод и
 * прожили там всё время, пока страница существует.
 *
 * Лечится одной строкой: набор стилей импортируется из своего же
 * `*.module.css`, а не через компонент. CSS-модуль можно открыть из любого
 * файла — и серверного, и клиентского.
 *
 * Это НЕ храповик: раскладки, которой нет, не бывает наполовину.
 */
const clientStyles = []
{
  /* Кто отдаёт наружу набор стилей, будучи клиентским. */
  const exported = new Map()
  for (const path of CODE) {
    const code = readFileSync(path, 'utf8')
    if (!/^['"]use client['"]/m.test(code)) continue
    const locals = new Set(
      [...code.matchAll(/import\s+(\w+)\s+from\s+'[^']+\.module\.css'/g)].map((m) => m[1]),
    )
    if (!locals.size) continue
    const names = new Set()
    for (const m of code.matchAll(/export\s*\{\s*(\w+)\s+as\s+(\w+)\s*\}/g)) {
      if (locals.has(m[1])) names.add(m[2])
    }
    for (const m of code.matchAll(/export\s+const\s+(\w+)\s*=\s*(\w+)\b/g)) {
      if (locals.has(m[2])) names.add(m[1])
    }
    if (names.size) exported.set(relative(ROOT, path).replace(/\.tsx?$/, ''), names)
  }
  /* Кто это читает, не будучи клиентским. */
  for (const path of CODE) {
    const rel = relative(ROOT, path)
    if (rel.includes('studio')) continue
    const code = readFileSync(path, 'utf8')
    if (/^['"]use client['"]/m.test(code)) continue
    const at = (index) => `${rel}:${code.slice(0, index).split('\n').length}`
    for (const m of code.matchAll(/import\s*(?:\w+\s*,\s*)?\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
      const spec = m[2]
      const from = spec.startsWith('@/')
        ? spec.slice(2)
        : spec.startsWith('.') ? relative(ROOT, join(dirname(path), spec)) : null
      if (!from) continue
      const names = exported.get(from)
      if (!names) continue
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/).pop()?.trim()
        if (name && names.has(name)) {
          clientStyles.push(`${at(m.index)}: ${name} из ${spec} — клиентский экспорт, на сервере это undefined`)
        }
      }
    }
  }
}
if (clientStyles.length) {
  console.error('\n✗ Набор стилей, прочитанный через клиентский компонент:')
  for (const t of clientStyles) console.error(`    ${t}`)
  console.error('\n  Импортируйте сам *.module.css — его можно открыть из любого файла. Через')
  console.error('  клиентский компонент свойство приходит пустым, и раскладки не будет вовсе.')
  process.exit(1)
}

/**
 * Класс из модуля, которого в модуле нет.
 *
 * `s.like` там, где правило `.like` уехало в примитивы, — это не ошибка типов
 * и не ошибка сборки: CSS-модуль отдаёт `undefined`, оно спокойно уезжает в
 * `className`, и в разметке остаётся строка «undefined». Вещь просто теряет
 * весь свой набор правил. Заказчик увидит это как исчезнувшее сердце на
 * снимке, а дифф будет безупречен.
 *
 * Заведено по счёту: сердце и значок скидки на карте товара ссылались на
 * классы, только что переехавшие в примитивы. Обе вещи пропали с витрины
 * молча, а `tsc` был зелёным — для него это `any`.
 *
 * Это НЕ храповик: класс, которого нет, не долг, который платят в своём
 * темпе. Валит сборку сразу.
 */
const missingClass = []
for (const path of CODE) {
  const rel = relative(ROOT, path)
  if (rel.includes('studio')) continue
  const code = readFileSync(path, 'utf8')
  /* Какие модули этот файл открыл и под какими именами. */
  const mods = new Map()
  for (const m of code.matchAll(/import\s+(\w+)\s+from\s+'([^']+\.module\.css)'/g)) {
    const [, local, spec] = m
    const file = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : join(dirname(path), spec)
    if (!existsSync(file)) continue
    const css = readFileSync(file, 'utf8')
    /* Множество берётся шире, чем надо: всякое `.имя` в файле. Ошибиться в
       сторону «класс есть» безопасно — проверка молчит; ошибиться в
       обратную значило бы врать про исправный код. */
    mods.set(local, { spec, names: new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((x) => x[1])) })
  }
  if (!mods.size) continue
  const at = (index) => `${rel}:${code.slice(0, index).split('\n').length}`
  for (const [local, mod] of mods) {
    const use = new RegExp(`\\b${local}\\.([A-Za-z_][\\w]*)\\b`, 'g')
    for (const m of code.matchAll(use)) {
      if (mod.names.has(m[1])) continue
      missingClass.push(`${at(m.index)}: ${local}.${m[1]} — в ${mod.spec} такого класса нет`)
    }
  }
}
if (missingClass.length) {
  console.error('\n✗ Класс из модуля, которого в модуле нет:')
  for (const t of missingClass) console.error(`    ${t}`)
  console.error('\n  CSS-модуль отдаёт undefined, оно уезжает в className, и вещь теряет весь')
  console.error('  свой набор правил молча. Ни tsc, ни сборка об этом не скажут.')
  process.exit(1)
}

const ids = new Set()
const families = new Set()
/* Каталога может не быть вовсе: в проект, куда набор только что лёг,
   `lib/products.ts` приедет не сегодня. Раньше этот же кусок читал файл
   молча и валил всю проверку стеком вызовов на первом же запуске в новом
   проекте — то есть набор не переживал собственной установки. Нет данных —
   семья не мерится, и об этом сказано вслух: молчаливый ноль неотличим от
   «всё чисто». */
const DATA = join(ROOT, 'lib/products.ts')
const hasData = existsSync(DATA)
if (hasData) {
  const data = readFileSync(DATA, 'utf8')
  for (const m of data.matchAll(/^  \{ id:'([^']*)'/gm)) ids.add(m[1])
  for (const m of data.matchAll(/family:'([^']*)'/g)) families.add(m[1])
} else {
  console.log('· две правды об одном факте: не мерилась — нет lib/products.ts')
}
/* Приставка марки берётся из самих данных, а не из списка в проверке: список
   разошёлся бы с каталогом на первой новой марке. */
const brands = new Set([...ids].map((id) => id.split('-')[0]))
const twoTruths = []
for (const path of CODE) {
  const rel = relative(ROOT, path)
  if (rel.includes('studio')) continue
  const code = strip(readFileSync(path, 'utf8').replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length)))
  const at = (index) => `${rel}:${code.slice(0, index).split('\n').length}`

  for (const m of code.matchAll(/'([a-z][a-z0-9]*-[a-z0-9-]+)'/g)) {
    const v = m[1]
    if (!brands.has(v.split('-')[0])) continue
    if (ids.has(v) || families.has(v)) continue
    twoTruths.push(`${at(m.index)}: '${v}' — такого товара в каталоге нет`)
  }

  /* Идентификатор и факт в одном объявлении. Строка, а не файл: рядом с
     идентификатором — это и значит «в этом же объекте». */
  for (const line of code.split('\n').entries()) {
    const [i, text] = line
    const id = /id:\s*'([a-z][a-z0-9]*-[a-z0-9-]+)'/.exec(text)
    if (!id || !brands.has(id[1].split('-')[0])) continue
    const fact = /\b(price|cbd|rating|reviews|batch|was)\s*:/.exec(text)
    if (fact) twoTruths.push(`${rel}:${i + 1}: ${fact[1]} товара '${id[1]}' набран рукой — в каталоге он уже есть`)
  }
}
if (twoTruths.length) {
  console.error('\n✗ Две правды об одном факте:')
  for (const t of twoTruths) console.error(`    ${t}`)
  console.error('\n  Факт товара живёт в lib/products.ts. Набранный второй раз, он расходится')
  console.error('  молча: оба числа выглядят правдоподобно. Спросите его, а не набирайте.')
  process.exit(1)
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
  inlinePx: 'число в разметке: инлайновый стиль мимо шкалы (правила 1 и 2)',
  zIndex: 'z-index числом: имя из --layer-* или верхний слой (<dialog>, popover)',
  focusGone: 'кольцо фокуса снято и не заменено — клавиатура теряет место',
  noPress: 'есть :hover, нет отклика на нажатие — на телефоне контрол молчит',
  stickyCap: 'приклеенное без потолка от окна: колонка выше ноутбука, низ не увидеть',
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
