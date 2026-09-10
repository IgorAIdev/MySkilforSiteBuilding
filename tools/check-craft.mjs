/**
 * Проверка ремесла — по отрисованной странице, а не по файлам.
 *
 * `check-css.mjs` читает стили и ловит то, что записано числом: размер в
 * пикселях, лишний брейкпоинт, пропорцию без потолка. Но дефект, который
 * заказчик видит на телефоне, обычно не записан числом — он получается.
 * Заголовок с мерой в 16ch занимает половину колонки. Отрицательное поле,
 * поставленное ради тени, съедает отступ, назначенный выше. Цель нажатия
 * выходит меньше пальца. В диффе всё это выглядит безупречно.
 *
 * Поэтому проверка открывает собранный сайт и меряет то, что получилось:
 *
 *   1. Мера текста     — у заголовка: занимает меньше 70% колонки и при этом
 *                        переносится, то есть ему назначили меру, которой он
 *                        не просил. У бегущего текста: строка короче 45 или
 *                        длиннее 75 знаков.
 *   2. Цель нажатия    — ссылка или кнопка меньше 44×44 на телефоне.
 *   3. Контраст        — текст ниже 4.5:1 (крупный ниже 3:1) к своему фону.
 *   4. Слипшиеся блоки — соседи по вертикали ближе 8px друг к другу.
 *   5. Вес снимка      — картинка, отданная вдвое крупнее места, куда её
 *                        положили: 1100px в кадр 358px это втрое больше
 *                        пикселей и вдевятеро больше байтов.
 *   6. Прыжок вёрстки  — картинка без width и height: место под неё не
 *                        занято, и всё под ней прыгает, когда она приедет.
 *   7. Безымянный орган— кнопка или ссылка, у которой нет ни текста, ни
 *                        `aria-label`: скринридер прочитает «кнопка».
 *   8. Лестница глав   — пропущенный уровень заголовка или второй h1.
 *   9. Разрядка (1.4.12)— страница под пользовательскими межбуквенным,
 *                        межсловным и межстрочным: WCAG требует, чтобы текст
 *                        не обрезался и не переполнял. Проверяется только на
 *                        узком окне, где запас меньше всего.
 *
 * Работает храповиком, как и `check:css`: в `tools/craft-baseline.json`
 * записано, сколько нарушений сегодня; проверка падает, только если их
 * стало больше. Проверка, падающая с первого дня, живёт до первого «давай
 * отключим».
 *
 *   npm run build:site && npx serve out -l 8099   (или python3 -m http.server)
 *   node tools/check-craft.mjs
 *   node tools/check-craft.mjs -- --update
 *
 * Playwright берётся оттуда же, откуда его берёт свип: из системы или из
 * PLAYWRIGHT.
 */

const { chromium } = await import(
  process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import sharp from 'sharp'

/** Контраст по WCAG — та же формула, что и в странице; здесь она нужна
 *  второй раз, снаружи, для дна, снятого с экрана. */
const pairOf = (a, b) => {
  const lum = (c) => {
    const [r, g, bl] = c.map((v) => {
      const x = v / 255
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const BASE = process.env.SITE ?? 'http://localhost:8099'
const PAGES = ['/', '/catalog', '/product', '/cart', '/checkout']
/* 1200 и 900 добавлены не для полноты. Ровно в этой полосе двухколоночный
   герой держит колонку шириной с телефон при десктопном окне: заголовок в ней
   вставал четырьмя строками по четырнадцать знаков, а подпись кадра — по
   одному слову. Ни 1024, ни 1440 этого не показывали. Дефект живёт там, где
   не смотрели. */
const WIDTHS = [390, 700, 900, 1024, 1200, 1440]
const PHONE = 700          // ниже этой ширины цель нажатия меряется пальцем
const BASELINE = new URL('./craft-baseline.json', import.meta.url).pathname
const ROOT = new URL('..', import.meta.url).pathname

/** Что меряется в самой странице. Одной функцией, потому что она уезжает
 *  в браузер целиком и ничего оттуда не импортирует. */
const measure = (phone) => {
  const out = { placeholder: [], measure: [], target: [], contrast: [], collision: [],
                weight: [], jump: [], name: [], heads: [], dress: [], dark: [] }
  const seen = new Set()

  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const x = v / 255
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const rgb = (s) => {
    const m = s.match(/-?[\d.]+/g)
    return m ? m.slice(0, 3).map(Number) : null
  }
  const alpha = (s) => {
    const m = s.match(/-?[\d.]+/g)
    return m && m.length > 3 ? Number(m[3]) : 1
  }
  /** Что лежит под текстом.
   *
   *  Раньше здесь искался «первый непрозрачный предок», а всё полупрозрачное
   *  пропускалось. На витрине это давало заведомо неверный ответ: подпись
   *  плитки — белая, лежит на вуали `rgba(8,26,31,.7)`, вуаль на снимке.
   *  Вуаль пропускалась как недостаточно плотная, снимок не виден вовсе, и
   *  проверка сообщала «белое на светло-сером, 1.07:1» — про текст, который
   *  на самом деле читается отлично.
   *
   *  Теперь слои собираются и накладываются друг на друга по-настоящему. А
   *  когда под ними остаётся неизвестное — фотография, градиент, что угодно
   *  с картинкой, — ответом становится не одно число, а два: как если бы
   *  снизу было чёрное и как если бы белое. Берётся худшее. Это гарантия, а
   *  не догадка: настоящий контраст не хуже неё, каким бы ни оказался
   *  снимок.
   */
  const ground = (el) => {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      const a = alpha(cs.backgroundColor)
      const c = rgb(cs.backgroundColor)
      if (c && a > 0.004) layers.push([c, a])
      if (a > 0.996) return { layers, known: true }
      /* градиент, снимок, что угодно нарисованное: дальше не заглянуть */
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { layers, known: false }
      /* Вуаль часто рисуют псевдоэлементом — `.slide::after` с градиентом
         поверх снимка. Обход предков её не видит вовсе: у самого слайда фон
         прозрачный, и проверка уходила искать дно до самой страницы, получая
         «белое на белом». Псевдоэлемент, у которого есть чем закрасить, —
         тот же случай «дальше не заглянуть». */
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(n, pseudo)
        if (ps.content === 'none') continue
        if ((ps.backgroundImage && ps.backgroundImage !== 'none') || alpha(ps.backgroundColor) > 0.004) {
          return { layers, known: false }
        }
      }
    }
    return { layers, known: true }
  }
  /** Слои, наложенные на заданное дно, от самого дальнего к ближнему. */
  const over = (layers, base) => {
    let out = base
    for (let i = layers.length - 1; i >= 0; i--) {
      const [c, a] = layers[i]
      out = out.map((v, k) => c[k] * a + v * (1 - a))
    }
    return out
  }
  const pair = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (l1 + 0.05) / (l2 + 0.05)
  }
  /** Контраст текста к тому, что под ним.
   *
   *  Дно известно — считаем точно. Неизвестно (снимок, градиент) — элемент
   *  откладывается: его дно снимут с экрана вторым проходом, по пикселям.
   *  Догадка «худшее из чёрного и белого» тут не годится: у вуали, заданной
   *  градиентом, самый прозрачный упор — полная прозрачность, и по нему
   *  выходит, что белая подпись лежит на белом. Она лежит на снимке. */
  const ratio = (fg, g) => (g.known ? pair(fg, over(g.layers, [255, 255, 255])) : null)
  window.__dark = []
  const name = (el) => {
    const cls = (el.className || '').toString().split(/\s+/)[0] || ''
    const txt = (el.textContent || '').trim().slice(0, 24)
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls.split('__').pop() : ''}${txt ? ` «${txt}»` : ''}`
  }
  const shown = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
    const b = el.getBoundingClientRect()
    if (b.width <= 0 || b.height <= 0) return false
    /* Убранное с экрана обрезкой — заголовок «только для чтения вслух»:
       он в дереве доступности есть, глазу его нет, мерить нечего. */
    if (b.width <= 1 || b.height <= 1) return false
    /* За краем экрана по горизонтали — значит сейчас не видно: закрытое
       чекмедже стоит на -320, уехавшая часть полосы прокрутки — за правым
       полем. Мерить их нельзя вдвойне: их не видит человек, и их не видит
       снимок страницы, который шириной ровно в экран. Раньше такие элементы
       считались, а дно им сэмплилось по чужим пикселям — отсюда «белое на
       белом» у пунктов закрытого меню. */
    const w = document.documentElement.clientWidth
    /* Не «край задет», а «видно по существу». В горизонтальной полосе шесть
       постов, из них на экране один: у остальных левый край ещё внутри, а
       сами они снаружи. Мерить по тридцати видимым пикселям из ста — гадать.
       Порог 60% ширины: меньше — элемента для человека сейчас нет. */
    const seen = Math.min(b.right, w) - Math.max(b.left, 0)
    return seen > 0 && seen / b.width >= 0.6
  }

  /* 1 · мера текста.
     Два разных дефекта, и мерить их надо по-разному.

     ЗАГОЛОВОК коротким не бывает по своей воле: если он переносится и при
     этом занимает половину колонки, значит ему назначили меру, которой он не
     просил. Справа остаётся пустота, а строки рвутся вкривь. Здесь верно
     мерить долю колонки.

     БЕГУЩИЙ ТЕКСТ, наоборот, обязан быть уже колонки — ради этого мера и
     существует. Абзац в 66 знаков внутри колонки в 900px занимает 62%, и это
     не дефект, а работа. Здесь доля колонки не говорит ничего, а говорит
     число ЗНАКОВ НА СТРОКУ: короче 45 строка рубится и глаз спотыкается,
     длиннее 75 — теряется на возврате. Это и есть мера в её исходном смысле,
     а процент был подменой.

     Раньше здесь стоял один порог на обоих, и он ругался на правильно
     ограниченные абзацы подвала — то есть требовал убрать меру там, где она
     нужна. */
  /* Столбиком рассыпается ЛЮБОЙ текст, не только заголовок: подпись кнопки,
     ссылка в списке, мелкая строка под плиткой. Мера набора (45…75 знаков) —
     про бегущий текст, поэтому её спрашивают с абзацев; столбик обрывков —
     про всех. */
  for (const el of document.querySelectorAll('h1, h2, h3, h4, p, blockquote, li, small, button, a, figcaption')) {
    if (!shown(el) || !el.textContent.trim()) continue
    /* Меряется ТОЛЬКО сплошной текст. У кнопки тарифа внутри три отдельных
       строки-элемента — название, пояснение, цена; сложенные в один поток,
       они выглядят как «сирота €39.52», которой нет: это отдельная строка по
       замыслу. Признак композита виден в раскладке потомков. */
    const composite = [...el.children].some((ch) => {
      const d = getComputedStyle(ch).display
      return d !== 'inline' && d !== 'contents' && d !== 'none'
    })
    if (composite) continue
    const cs = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
    /* Дёшево — потом точно. Высота коробки включает подкладку: у кнопки с
       полем 12px «Drops» выходило четыре строки по пять знаков, и проверка
       ругалась на текст, стоящий одной строкой. Поэтому высота — только
       грубый отсев, а строки считаются обходом по знакам: он даёт и их
       число, и длину каждой В ЗНАКАХ, а не в пикселях. Прикидка «полкегля
       на знак» тоже врала: у жирного наборного знак шире. */
    if (box.height / lh < 1.6) continue
    const rows = []
    {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let node, chars = 0
      const r = document.createRange()
      let last = null, row = ''
      while ((node = walk.nextNode()) && chars < 400) {
        for (let i = 0; i < node.length; i++, chars++) {
          r.setStart(node, i); r.setEnd(node, i + 1)
          const rect = r.getBoundingClientRect()
          if (!rect.width && !rect.height) continue
          const top = Math.round(rect.top)
          if (last !== null && top !== last) { rows.push(row); row = '' }
          last = top; row += node.data[i]
        }
      }
      rows.push(row)
    }
    const lines = rows.filter((x) => x.trim()).length
    if (lines < 2) continue                     // одна строка меры не имеет
    const head = /^H[1-4]$/.test(el.tagName)
    const rowLen = rows.map((x) => x.trim().length)
    const widest = Math.max(...rowLen)

    /* Столбик обрывков. Три строки и больше, а самая длинная короче двадцати
       знаков — текст читается не строкой, а списком огрызков: «CBD / oil and /
       cannabis / oil». Долю колонки такой блок проходит (сто процентов!),
       поэтому мерить надо ЗНАКИ. Причина всегда одна: размер взят от окна, а
       стоит текст в узкой коробке. */
    /* Но короткая строка в УЗКОЙ коробке — не вина текста: в плитке шириной
       178px двадцати знаков не бывает физически, и требовать их значит
       требовать другую раскладку, а не другой набор. Дефект — когда место
       ЕСТЬ (коробка от 320px) или когда кегль сам крупный (от 20px, где
       короткая строка неверна всегда). Ровно эти два случая заказчик и
       показывал: заголовок героя в 488px и подпись кадра в 30px. */
    const roomy = box.width >= 320 || parseFloat(cs.fontSize) >= 20
    if (roomy && lines >= 3 && widest < 20) {
      out.measure.push(`${name(el)} — ${lines} строки, самая длинная ${widest} знаков: столбик обрывков`)
      continue
    }

    /* Сирота — последняя строка в одно короткое слово: «…Full and broad /
       spectrum.» Глаз ждёт продолжения, а его нет.

       Лечится не руками, а режимом переноса: `pretty` правит последнюю строку
       бегущего текста, `balance` делит короткий текст поровну и ставит разрыв
       на границе предложения. Проверка нужна, чтобы их не забыли назначить. */
    const tail = rows[rows.length - 1]?.trim() ?? ''
    if (roomy && lines >= 2 && tail && !tail.includes(' ') && tail.length < 12 && tail.length < widest * 0.3) {
      out.measure.push(`${name(el)} — последняя строка «${tail}»: сирота`)
      continue
    }

    if (head) {
      const host = el.parentElement
      if (!host) continue
      const hostW = host.getBoundingClientRect().width
        - parseFloat(getComputedStyle(host).paddingLeft)
        - parseFloat(getComputedStyle(host).paddingRight)
      if (hostW < 80) continue
      const fill = box.width / hostW
      if (fill < 0.7) out.measure.push(`${name(el)} — ${Math.round(fill * 100)}% колонки, строк ${lines}`)
      continue
    }

    /* В узкой коробке текст короткой строкой не по своей вине: в карточке
       шириной 200px сорока пяти знаков не бывает физически. Это решение
       раскладки, а не меры, и ругаться на него здесь не о чем. */
    if (box.width < 320) continue
    const chars = el.textContent.trim().length / lines
    /* Нижняя граница — про бегущий текст, а не про короткую фразу. Заметка
       под заголовком в две строки по сорок знаков не рубленая колонка, она
       просто короткая: делить нечего, и мера тут ни при чём. Поэтому снизу
       спрашиваем с трёх строк и больше. Сверху — всегда: длинная строка
       теряется на возврате хоть на второй, хоть на двадцатой. */
    if (chars > 75) {
      out.measure.push(`${name(el)} — ${Math.round(chars)} знаков в строке, длинно (нужно ≤75)`)
    } else if (lines >= 3 && chars < 45) {
      /* Коротко — не всегда дефект. На экране в 390px сорок знаков в строке
         это норма: колонка столько и есть, шире некуда. Дефект — когда место
         ЕСТЬ, а текст его не берёт: мера уже колонки. Поэтому спрашиваем
         только с тех, кто занимает меньше 85% доступного. */
      const host = el.parentElement
      const hostW = host
        ? host.getBoundingClientRect().width
          - parseFloat(getComputedStyle(host).paddingLeft)
          - parseFloat(getComputedStyle(host).paddingRight)
        : 0
      if (hostW > 0 && box.width / hostW < 0.85) {
        out.measure.push(`${name(el)} — ${Math.round(chars)} знаков в строке при ${Math.round(box.width / hostW * 100)}% колонки`)
      }
    }
  }

  /* 2 · цель нажатия.
     Меряется область попадания, а не рисунок. Орган бывает нарисован мельче
     по делу — сердце «сохранить» в углу снимка в 32px это правильный
     рисунок, — и тогда ему пририсовывают невидимый запас псевдоэлементом
     (`.tap` в примитивах). Коробка элемента про этот запас не знает, поэтому
     к ней добавляются размеры абсолютно позиционированных псевдоэлементов:
     они центрированы на органе, значит больший из размеров и есть область.

     Проверка, меряющая рисунок, требовала бы рисовать палец — то есть
     запрещала бы мелкие органы вовсе. Требование не в этом: попасть пальцем,
     не увеличивая кнопку. */
  if (phone) {
    for (const el of document.querySelectorAll('a, button, [role="button"], input, select')) {
      if (!shown(el)) continue
      const b = el.getBoundingClientRect()
      /* Ссылка в тексте — это слово, а не кнопка: её размер задаёт набор, и
         требовать от неё ширину пальца значит разорвать строку. WCAG 2.5.8
         делает ровно это исключение — «inline in a sentence».

         Признак не «внутри абзаца», а «рядом со словами»: хлебные крошки
         лежат в `div`, но между ссылками там текстовые узлы с косой чертой,
         и это тот же текстовый поток. */
      if (el.tagName === 'A') {
        const host = el.parentElement
        const inText = host && [...host.childNodes]
          .some((n) => n.nodeType === 3 && n.textContent.trim())
        if (el.closest('p') || inText) continue
      }
      let w = b.width, h = b.height
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(el, pseudo)
        if (ps.content === 'none' || ps.position !== 'absolute') continue
        w = Math.max(w, parseFloat(ps.width) || 0)
        h = Math.max(h, parseFloat(ps.height) || 0)
      }
      if (w < 44 || h < 44) {
        out.target.push(`${name(el)} — ${Math.round(w)}×${Math.round(h)}`)
      }
    }
  }

  /* 3 · контраст */
  for (const el of document.querySelectorAll('h1,h2,h3,h4,p,a,span,b,small,li,button,label,td,th')) {
    if (!shown(el)) continue
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own) continue
    const cs = getComputedStyle(el)
    const fg = rgb(cs.color)
    if (!fg || alpha(cs.color) < 0.95) continue
    const size = parseFloat(cs.fontSize)
    const big = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
    const need = big ? 3 : 4.5
    const g = ground(el)
    const got = ratio(fg, g)
    if (got === null) {
      /* дно снимут с экрана: сюда попадает всё, что лежит на фотографии */
      const b = el.getBoundingClientRect()
      window.__dark.push(el)
      out.dark.push({ i: window.__dark.length - 1, fg, need, label: name(el),
                      x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height })
      continue
    }
    if (got < need) {
      /* Стилям верить на слово нельзя. Они не видят ни псевдоэлемента, ни
         наложенного соседа: у поста инстаграма подпись лежит на вуали-соседе,
         а обход предков находит светлый фон карточки под ней и сообщает
         «белое на белом, 1.07». Поэтому расчёт по стилям — только быстрый
         отсев, а провал подтверждается пикселями. Пропуск по стилям при этом
         остаётся пропуском: наложенный слой может сделать хуже, но такой
         случай ловится тем же снимком у соседей по тому же месту. */
      const b = el.getBoundingClientRect()
      window.__dark.push(el)
      out.dark.push({ i: window.__dark.length - 1, fg, need, label: name(el),
                      x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height })
    }
  }

  /* 0 · заглушка на витрине: `[NAME]`, `[COMPANY]`, `[Stand-in clip.]`.
     В ведомости они помечены как «факт, который ещё не известен», но на
     живом сайте это не пометка, а текст, который читает покупатель: отзыв,
     подписанный `[NAME] · [CITY]`, сообщает, что отзывы ненастоящие. */
  const holder = /\[(?:[A-ZА-Я][A-ZА-Я0-9 @._-]{2,}|Stand-in[^\]]*)\]/g
  for (const m of (document.body.innerText || '').matchAll(holder)) {
    const key = `h:${m[0]}`
    if (!seen.has(key)) { seen.add(key); out.placeholder.push(m[0]) }
  }

  /* 4 · слипшиеся блоки: соседи по потоку ближе 8px.
     Считается воздух, а не расстояние между коробками. Раздел, у которого
     воздух назначен собственным верхним полем, стоит к соседу вплотную
     коробкой и на экране при этом отбит как надо — это не дефект, а обычное
     устройство раздела. Дефект — когда воздуха нет ни снаружи, ни внутри:
     ровно так лист «CBD products by category» проходил в двенадцати
     пикселях под плитками и срезал их снизу. */
  /* Рисует ли блок собственную поверхность. Если да — его внутреннее поле
     лежит УЖЕ ВНУТРИ неё и от соседа не отбивает: видно край, а не воздух.
     Ровно так лист «CBD products by category» проходил в двенадцати пикселях
     под плитками: воздуха внутри было пятьдесят, а срезал он их всё равно. */
  const paints = (el) => {
    const cs = getComputedStyle(el)
    return alpha(cs.backgroundColor) > 0.02 ||
           (!!cs.backgroundImage && cs.backgroundImage !== 'none') ||
           (cs.boxShadow && cs.boxShadow !== 'none')
  }
  const inner = (el, side) => {
    if (paints(el)) return 0
    const own = parseFloat(getComputedStyle(el)[side]) || 0
    const kid = side === 'paddingTop' ? el.firstElementChild : el.lastElementChild
    if (!kid || paints(kid)) return own
    return Math.max(own, parseFloat(getComputedStyle(kid)[side]) || 0)
  }
  const rows = Array.from(document.querySelectorAll('main > * > *, main > *'))
    .filter(shown)
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], next = rows[i]
    const a = prev.getBoundingClientRect(), b = next.getBoundingClientRect()
    if (b.top < a.bottom) continue              // перекрываются — не соседи по потоку
    const air = (b.top - a.bottom) + inner(next, 'paddingTop') + inner(prev, 'paddingBottom')
    if (air >= 0 && air < 8) {
      out.collision.push(`${name(prev)} → ${name(next)} — воздуха ${Math.round(air)}px`)
    }
  }

  /* 5 · вес снимка. Меряется в пикселях, а не в байтах: байты зависят от
     сжатия, а пикселей отдано ровно столько, сколько решил тот, кто вставил
     картинку. Порог 2× — это уже вчетверо больше данных, чем нужно даже
     экрану с удвоенной плотностью. */
  for (const img of document.images) {
    if (!shown(img) || !img.naturalWidth) continue
    const w = img.getBoundingClientRect().width
    if (w < 24) continue
    const over = img.naturalWidth / w
    if (over > 2 && !img.srcset) {
      const key = `w:${img.currentSrc}:${Math.round(w)}`
      if (!seen.has(key)) {
        seen.add(key)
        out.weight.push(`${img.currentSrc.split('/').pop()} — ${img.naturalWidth}px в ${Math.round(w)}px, ×${over.toFixed(1)}`)
      }
    }
  }

  /* 6 · прыжок вёрстки: у картинки не занято место заранее. Размеры годятся
     любые — важна пропорция, по которой браузер держит коробку, пока файл
     едет. `aspect-ratio` в стиле считается тем же самым. */
  for (const img of document.images) {
    if (!shown(img)) continue
    const cs = getComputedStyle(img)
    const held = (img.getAttribute('width') && img.getAttribute('height')) ||
                 (cs.aspectRatio && cs.aspectRatio !== 'auto')
    if (held) continue
    const key = `j:${img.getAttribute('src')}`
    if (!seen.has(key)) { seen.add(key); out.jump.push(`${(img.getAttribute('src') || '?').split('/').pop()} — без width/height`) }
  }

  /* 7 · безымянный орган. Имя ищется там же, где его ищет скринридер: свой
     текст, aria-label, aria-labelledby, title, alt вложенной картинки. */
  const named = (el) => {
    if ((el.textContent || '').trim()) return true
    if (el.getAttribute('aria-label') || el.getAttribute('title')) return true
    const by = el.getAttribute('aria-labelledby')
    if (by && by.split(/\s+/).some((id) => document.getElementById(id))) return true
    const img = el.querySelector('img[alt]')
    if (img && img.getAttribute('alt').trim()) return true
    return false
  }
  for (const el of document.querySelectorAll('a[href], button, [role="button"], summary')) {
    if (!shown(el) || named(el)) continue
    const key = `n:${el.tagName}:${(el.className || '').toString().slice(0, 30)}`
    if (!seen.has(key)) { seen.add(key); out.name.push(name(el) || el.tagName.toLowerCase()) }
  }
  /* Картинка без атрибута alt вовсе — это не решение, а пропуск: пустой alt
     говорит «украшение», отсутствующий не говорит ничего, и скринридер
     читает адрес файла. */
  for (const img of document.images) {
    if (!shown(img) || img.hasAttribute('alt')) continue
    const key = `a:${img.getAttribute('src')}`
    if (!seen.has(key)) { seen.add(key); out.name.push(`img ${(img.getAttribute('src') || '?').split('/').pop()} — без alt`) }
  }

  /* 8 · лестница заголовков: ровно один h1 и ни одного пропущенного уровня.
     Скринридер ходит по странице заголовками — пропуск с h2 на h4 читается
     как «здесь что-то потеряно». */
  /* Лестница заголовков живёт в дереве доступности, а не на картинке.
     Заголовок «только для чтения вслух» убран с экрана обрезкой — глазу его
     нет, скринридеру есть, и в лестнице он считается. Поэтому здесь своя
     проверка видимости: не `display:none`, не `visibility:hidden`, не
     `aria-hidden`, не внутри `inert`. */
  const spoken = (el) => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden') return false
    }
    return !!(el.textContent || '').trim()
  }
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(spoken)
  const ones = hs.filter((h) => h.tagName === 'H1')
  if (ones.length !== 1) out.heads.push(`h1 на странице: ${ones.length}`)
  let prev = 0
  for (const h of hs) {
    const lvl = Number(h.tagName[1])
    if (prev && lvl > prev + 1) out.heads.push(`${name(h)} — h${prev} → h${lvl}`)
    prev = lvl
  }

  /* Одно действие — одна одежда.
   *
   * Выход из блока («весь индекс») рисуется общим компонентом, который берёт
   * одежду из выбранного набора. На странице товара стояла своя, записанная
   * буквой прямо в разметке: та же кнопка выходила другой высоты, без поля и
   * с лишней литерой. Заказчик увидел это глазом, сравнив два экрана.
   *
   * Признак в файле не виден: разметка там законная, а расходятся страницы.
   * Виден он ровно здесь — на отрисованной странице, где одежд оказывается
   * больше одной. */
  const dresses = [...new Set([...document.querySelectorAll('[data-more]')]
    .filter(shown).map((el) => el.dataset.more))]
  if (dresses.length > 1) {
    out.dress.push(`одежд у выхода из блока: ${dresses.length} (${dresses.join(', ')}) — должна быть одна`)
  }

  return out
}

const browser = await chromium.launch()
/* Две среды, а не одна ширина. Узкое окно — это ещё не телефон: у телефона
   нет курсора, и `(pointer: coarse)` — единственный честный признак пальца.
   Вёрстка, которая растит цель нажатия под палец, обязана растить её именно
   по этому признаку, а не по ширине: планшет с мышью шире телефона, а
   ноутбук с сенсорным экраном — шире обоих. Проверка, эмулирующая только
   ширину, такую вёрстку не увидела бы и потребовала бы вернуть брейкпоинт. */
const desk = await browser.newContext()
/* Плотность экрана здесь единица, а не двойка. Палец эмулируется `hasTouch`,
   а удвоенная плотность только раздувает снимок страницы вчетверо: на
   телефоне это 780 на семнадцать тысяч пикселей, и проверка из двадцати
   секунд превращалась в пять минут. Мерить контраст двойная плотность не
   помогает — цвет тот же. */
const hand = await browser.newContext({ hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
let page = await desk.newPage()
const found = { placeholder: [], measure: [], target: [], contrast: [], collision: [],
                weight: [], jump: [], name: [], heads: [], dress: [] }

for (const path of PAGES) {
  for (const w of WIDTHS) {
    const phone = w < PHONE
    /* Страница берётся из той среды, которую изображаем: сменить
       `hasTouch` у живой страницы нельзя, это свойство контекста. */
    const want = phone ? hand : desk
    if (page.context() !== want) { await page.close(); page = await want.newPage() }
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(150)

    /* Убедиться, что открылся САЙТ, а не что-то другое на том же порту.
       Дефект, из-за которого проверка заведена: на 8099 висел
       `python3 -m http.server`, который отдаёт листинг каталога и не знает,
       что `/product` это `product.html`. Три страницы из пяти не мерились
       вовсе — а проверка при этом рапортовала числа и была зелёной.
       Молчаливо неполный замер хуже отсутствующего: он выглядит как
       результат. */
    const real = await page.evaluate(() =>
      !!document.querySelector('header') && !!document.querySelector('main'))
    if (!real) {
      console.error(`\n✗ ${BASE}${path} — это не страница сайта.
    Скорее всего порт занят другим сервером или сайт не собран.
    Нужен статический сервер, умеющий чистые адреса:
        npm run build:site && npx serve out -l 8099`)
      await browser.close()
      process.exit(1)
    }
    const r = await page.evaluate(measure, phone)

    /* ── второй проход: дно, которое не прочитать стилями ──────────────────
       Подпись на фотографии лежит на вуали, вуаль задана градиентом, то есть
       картинкой. Ни один обход предков про её цвет ничего не скажет. Поэтому
       у таких строк дно снимается с экрана: буквы делаются прозрачными,
       страница снимается целиком, и под каждой строкой берётся средний цвет
       того, что осталось. Это ровно то, что видит глаз.

       Прозрачным делается `color`, а не `visibility`: фон, тень и вуаль
       должны остаться на месте — снимаем именно их. */
    if (r.dark.length) {
      /* Дно снимается по координатам ОКНА, а не документа.
       *
       * Полностраничный снимок и `getBoundingClientRect() + scrollY` — не
       * одно и то же: на телефоне Chromium снимает страницу иначе, чем
       * держит её на экране, и координаты расходятся. Проверено выемкой
       * куска: под подписью поста инстаграма оказывался нижний край тёмной
       * полосы страницей ниже, и подпись «получала» 3.85:1 от чужого места.
       * Четыре переделки вуали на этот замер не влияли никак — верный
       * признак, что мерилось не то.
       *
       * Поэтому: подвести элемент к экрану, снять кусок по координатам окна,
       * взять средний цвет. Снимков больше, но каждый — крошечный, и они
       * дешевле одного полностраничного. */
      await page.evaluate(async () => {
        for (const i of document.images) i.loading = 'eager'
        await Promise.all([...document.images].map((i) => i.decode().catch(() => {})))
      })
      const dedupe = new Set()
      for (const d of r.dark) {
        const box = await page.evaluate(({ i }) => {
          const el = window.__dark[i]
          el.scrollIntoView({ block: 'center' })
          /* буквы прозрачны, плавающие слои сняты: под текстом должно
             остаться ровно то, на чём он лежит */
          window.__was = el.style.color
          el.style.color = 'transparent'
          window.__hid = [...document.querySelectorAll('*')]
            .filter((e) => { const p = getComputedStyle(e).position; return p === 'fixed' || p === 'sticky' })
          window.__hidWas = window.__hid.map((e) => e.style.visibility)
          window.__hid.forEach((e) => { e.style.visibility = 'hidden' })
          const b = el.getBoundingClientRect()
          return { x: b.left, y: b.top, w: b.width, h: b.height,
                   vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio }
        }, { i: d.i })

        let got = null
        const left = Math.max(0, Math.round(box.x))
        const top = Math.max(0, Math.round(box.y))
        const width = Math.min(Math.round(box.w), box.vw - left)
        const height = Math.min(Math.round(box.h), box.vh - top)
        if (width >= 2 && height >= 2) {
          const shot = await page.screenshot({ clip: { x: left, y: top, width, height } })
          const px = await sharp(shot).resize(1, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer()
          got = pairOf(d.fg, [px[0], px[1], px[2]])
        }

        await page.evaluate(({ i }) => {
          window.__dark[i].style.color = window.__was
          window.__hid.forEach((e, k) => { e.style.visibility = window.__hidWas[k] })
        }, { i: d.i })

        if (got !== null && got < d.need) {
          const key = `${d.label}|${Math.round(got * 100)}`
          if (!dedupe.has(key)) {
            dedupe.add(key)
            r.contrast.push(`${d.label} — ${got.toFixed(2)}:1 при ${d.need}`)
          }
        }
      }
    }
    delete r.dark

    for (const k of Object.keys(r)) {
      for (const line of r[k]) {
        /* Заглушка — про НАПОЛНЕНИЕ, а не про ширину: `[NAME]` под отзывом
           один и тот же на всех шести ширинах, и это одно место, а не шесть
           дефектов. Считать её на каждой ширине значит мерить не то — та же
           ошибка, что и «одно объявление столько раз, сколько в нём чисел».
           Остальные семьи от ширины зависят, и там повтор законен. */
        found[k].push(k === 'placeholder' ? `${path}  ${line}` : `${path} @${w}  ${line}`)
      }
    }
  }
}
await browser.close()

found.placeholder = [...new Set(found.placeholder)]

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
  console.error(`Нет ${relative(ROOT, BASELINE)}. Создать: npm run check:craft -- --update`)
  process.exit(1)
}

const NAMES = {
  placeholder: 'заглушка на витрине ([NAME], [COMPANY], [Stand-in clip.])',
  measure: 'мера текста уже колонки (заголовок в половину ширины)',
  target: 'цель нажатия меньше 44×44 на телефоне',
  contrast: 'контраст ниже порога',
  collision: 'соседние блоки ближе 8px',
  weight: 'снимок отдан вдвое крупнее места (нет srcset)',
  jump: 'картинка без width/height — вёрстка прыгнет',
  name: 'орган без имени (ни текста, ни aria-label, ни alt)',
  heads: 'лестница заголовков: пропуск уровня или не один h1',
  dress: 'одно действие в двух одеждах: выход из блока рисуется по-разному',
}

/* `--list <семья>` печатает найденное целиком, не трогая базу: чинить проще,
   когда видно всё, а не первые двенадцать строк при провале. */
const asked = process.argv[process.argv.indexOf('--list') + 1]
if (process.argv.includes('--list')) {
  for (const key of Object.keys(NAMES)) {
    if (asked && asked !== key) continue
    console.log(`\n── ${NAMES[key]} (${found[key].length})`)
    for (const line of found[key]) console.log(`   ${line}`)
  }
  process.exit(0)
}

let failed = false
for (const key of Object.keys(NAMES)) {
  const now = counts[key], was = base[key] ?? 0
  if (now > was) {
    failed = true
    console.error(`\n✗ ${NAMES[key]}: было ${was}, стало ${now}`)
    for (const line of found[key].slice(0, 12)) console.error(`    ${line}`)
  } else if (now < was) {
    console.log(`✓ ${NAMES[key]}: ${was} → ${now}`)
  } else {
    console.log(`· ${NAMES[key]}: ${now}`)
  }
}

if (failed) {
  console.error(`
Стало хуже, чем было. Либо чините, либо — если это осознанное решение —
обновляйте базу: npm run check:craft -- --update`)
  process.exit(1)
}
