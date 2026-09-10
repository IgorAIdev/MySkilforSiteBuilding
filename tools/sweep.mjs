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

  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    height: document.body.scrollHeight,
    /* Высоты крупных блоков — чтобы скачок можно было назвать по имени, а не
       только заметить по сумме. */
    blocks: [...document.querySelectorAll('main > *')]
      .map((el) => Math.round(el.getBoundingClientRect().height)),
  }))

  await page.screenshot({
    path: `${out}/${String(w).padStart(4, '0')}.png`,
    fullPage: !fold,
  })
  rows.push({ w, over: m.scroll - m.inner, height: m.height, blocks: m.blocks })
}

await browser.close()

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
if (overflow.length) process.exitCode = 1
