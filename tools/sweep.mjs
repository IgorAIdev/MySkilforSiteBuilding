/**
 * Съёмка страницы по ширинам.
 *
 * У агента нет окна, которое можно потянуть за угол. Он видит макет на тех
 * ширинах, которые ему показали, — обычно на двух, — и пишет код, верный
 * ровно в этих двух точках. Ломается всё между ними: колонки разъезжаются,
 * кадр вырастает на весь экран, ряд меню упирается в край. Это не гипотеза,
 * а разбор того, как проект набрал 180 медиазапросов.
 *
 * Свип превращает «не вижу промежуточные ширины» в то, на что можно
 * смотреть: каждая ширина от 320 до 1600 с шагом 40, PNG в .sweep/, плюс
 * два автоматических диагноза — горизонтальное переполнение и скачки высоты
 * между соседними ширинами.
 *
 *   npm run build:site && npx serve out -l 8099     (или next dev)
 *   node tools/sweep.mjs                            вся страница целиком
 *   node tools/sweep.mjs /product --fold            только первый экран
 *
 * Set PLAYWRIGHT= to point at a Playwright install if it is not global.
 */

/* Playwright стоит в системе, а не в проекте — как и в tools/shade.mjs. */
const { chromium } = await import(
  process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { mkdirSync, rmSync } from 'node:fs'

const args = process.argv.slice(2)
const path = args.find((a) => a.startsWith('/')) ?? '/'
const fold = args.includes('--fold')
const base = process.env.SITE ?? 'http://localhost:8099'

const FROM = 320, TO = 1600, STEP = 40
const HEIGHT = 900
/* Скачок высоты больше пятой части при шаге в 40px — это не «макет плавно
   подстроился», это что-то схлопнулось или выросло. Смотреть глазами. */
const JUMP = 0.2

const out = new URL('../.sweep', import.meta.url).pathname
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
const rows = []

for (let w = FROM; w <= TO; w += STEP) {
  await page.setViewportSize({ width: w, height: HEIGHT })
  await page.goto(base + path, { waitUntil: 'networkidle' })
  /* Ширина читается после верстания, а не сразу после goto: шрифты меняют
     метрики, и до их загрузки высота — чужая. */
  await page.evaluate(() => document.fonts.ready)

  const m = await page.evaluate(() => {
    /* Набор ломается ПОЛОСОЙ ширин, а не точкой.
     *
     * Подпись кадра рассыпалась на «CBD / oil and / cannabis / oil» в полосе
     * примерно 840…880: там кадр уже узкий, а раскладка ещё двухколоночная.
     * Отрисованная проверка смотрит шесть ширин — и эту полосу проскочила
     * целиком. Свип идёт шагом в 40px от 320 до 1600, то есть по полосам, и
     * место такой проверке здесь.
     *
     * Правила те же, что в `check:craft`: столбик обрывков и сирота, и та же
     * оговорка — короткая строка в узкой коробке не вина текста. */
    const bad = []
    const nodes = document.querySelectorAll('h1,h2,h3,h4,p,li,small,button,a,blockquote,figcaption')
    for (const el of nodes) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      if (!el.textContent.trim()) continue
      if ([...el.children].some((ch) => {
        const d = getComputedStyle(ch).display
        return d !== 'inline' && d !== 'contents' && d !== 'none'
      })) continue
      const box = el.getBoundingClientRect()
      if (box.width < 4 || box.top > innerHeight * 4) continue
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
      if (box.height / lh < 1.6) continue
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const r = document.createRange()
      const rows = []
      let node, chars = 0, last = null, row = ''
      while ((node = walk.nextNode()) && chars < 300) {
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
      const len = rows.map((x) => x.trim().length).filter(Boolean)
      if (len.length < 2) continue
      const widest = Math.max(...len)
      const roomy = box.width >= 320 || parseFloat(cs.fontSize) >= 20
      if (!roomy) continue
      const label = `${el.tagName.toLowerCase()} «${el.textContent.trim().slice(0, 24)}»`
      if (len.length >= 3 && widest < 20) bad.push(`${label} — ${len.length} строки по ≤${widest}: столбик`)
      const tail = rows[rows.length - 1].trim()
      if (tail && !tail.includes(' ') && tail.length < 12 && tail.length < widest * 0.3) {
        bad.push(`${label} — последняя строка «${tail}»: сирота`)
      }
    }
    return {
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      height: document.body.scrollHeight,
      bad,
      /* Высоты крупных блоков — чтобы скачок можно было назвать по имени, а не
         только заметить по сумме. */
      blocks: [...document.querySelectorAll('main > *')]
        .map((el) => Math.round(el.getBoundingClientRect().height)),
    }
  })

  await page.screenshot({
    path: `${out}/${String(w).padStart(4, '0')}.png`,
    fullPage: !fold,
  })
  rows.push({ w, over: m.scroll - m.inner, height: m.height, blocks: m.blocks, bad: m.bad })
}

await browser.close()

let bandsFailed = false
const overflow = rows.filter((r) => r.over > 1)
const jumps = []
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1], b = rows[i]
  const delta = Math.abs(b.height - a.height) / Math.max(a.height, b.height)
  if (delta <= JUMP) continue
  /* Кто именно скакнул. Сетка, теряющая колонку, меняет высоту всегда —
     это не дефект, а устройство сетки. Дефект — когда прыгает один блок,
     который перестраиваться не должен, или когда прыгают все сразу. */
  const movers = a.blocks
    .map((h, k) => ({ k, from: h, to: b.blocks[k] ?? h }))
    .filter((x) => Math.abs(x.to - x.from) / Math.max(x.from, x.to, 1) > 0.15)
  jumps.push({ from: a.w, to: b.w, a: a.height, b: b.height, movers })
}

console.log(`\n${rows.length} ширин, ${FROM}…${TO}px, снимки в .sweep/\n`)

if (overflow.length) {
  console.log('✗ Горизонтальное переполнение — страницу можно утащить вбок:')
  for (const r of overflow) console.log(`    ${r.w}px — вылезает на ${r.over}px`)
} else {
  console.log('✓ Горизонтального переполнения нет ни на одной ширине')
}

/* Набор по полосам. Одно и то же место ломается на нескольких соседних
   ширинах — печатается один раз с полосой, а не тридцать раз подряд. */
const bands = new Map()
for (const r of rows) {
  for (const b of r.bad ?? []) {
    if (!bands.has(b)) bands.set(b, [])
    bands.get(b).push(r.w)
  }
}
if (bands.size) {
  console.log(`\n✗ Набор ломается на полосе ширин (${bands.size}):`)
  for (const [what, ws] of bands) {
    console.log(`    ${what}`)
    console.log(`      ${ws[0]}…${ws[ws.length - 1]}px (${ws.length} шир.)`)
  }
  bandsFailed = true
} else {
  console.log('✓ Столбиков и сирот нет ни на одной ширине')
}

if (jumps.length) {
  console.log('\n· Скачки высоты (смотреть, не обязательно чинить):')
  for (const j of jumps) {
    console.log(`    ${j.from} → ${j.to}px:  ${j.a} → ${j.b}px ` +
      `(${j.b > j.a ? '+' : ''}${Math.round((j.b - j.a) / j.a * 100)}%)` +
      `  блоки: ${j.movers.map((m) => `#${m.k} ${m.from}→${m.to}`).join(', ') || '—'}`)
  }
  console.log('\n  Сетка, теряющая колонку, меняет высоту всегда — это её')
  console.log('  устройство, а не дефект. Смотреть стоит, когда скачет один блок,')
  console.log('  которому перестраиваться незачем, или когда скачут все разом:')
  console.log('  тогда страница дёргается вся сразу, как на общем брейкпоинте.')
} else {
  console.log('✓ Высота меняется плавно, рывков нет')
}

console.log()
/* Переполнение — дефект всегда: страницу можно утащить вбок. Скачок высоты
   дефектом быть не обязан, поэтому он не валит проверку, а сообщается. */
if (overflow.length || bandsFailed) process.exitCode = 1
