/**
 * How dark a photograph needs its scrim.
 *
 * A single shade for six pictures is the wrong number six times: a lit
 * bedroom wall needs three times what a dark gym wall needs, and tuning one
 * value until the worst tile is legible leaves the other five muddy.
 *
 * So the number is measured, not chosen. И меряется оно с экрана, а не
 * рисованием снимка в canvas по вычисленной геометрии.
 *
 * Рисование было первым способом и оказалось неверным. Оно повторяло кроп
 * `object-fit: cover` вручную и брало полосу, высота которой предполагалась
 * по `--edge`. Стоило вуали переехать с кадра на саму подпись — геометрия
 * разошлась, и числа стали врать в разы: «CBD paste» получил 0.186 при
 * настоящих 0.45 под текстом. Вуаль, посчитанная по такому числу, вышла
 * почти нулевой, а подпись — 2.09:1 вместо 4.5.
 *
 * Поэтому теперь: вуаль выключается (`data-shade='off'`), буквы делаются
 * прозрачными, страница снимается целиком, и под каждой подписью берётся
 * ровно то, что осталось. Никакой геометрии предполагать не нужно — под
 * текстом лежит то, что лежит.
 *
 * Из этих пикселей берётся средняя яркость самой светлой пятой части —
 * замер по светлым пятнам, а не по среднему: белый текст проваливается на
 * светлых местах, которые пересекает, а не на средней яркости кадра.
 *
 * И снимается это на нескольких ширинах, а не на одной. `object-fit: cover`
 * режет снимок по-разному, когда меняется пропорция кадра: на 1024 плитка
 * уже, кроп другой, и под подписью оказывается совсем другой кусок кадра.
 * «Cannabis oil capsules» на 1560 давал 0.30, на 1024 — вдвое светлее.
 * Число берётся худшее (самое светлое) из всех ширин: вуаль, достаточная
 * для худшего случая, достаточна для всех.
 *
 * The result goes to lib/bright.ts, which holds nothing but the numbers.
 * The arithmetic that turns them into an alpha is hand-written in
 * lib/shade.ts, so a re-run cannot overwrite it — which is what happened the
 * first time this script emitted both.
 *
 *   node tools/shade.mjs            (with the site served on :8099)
 *
 * Set PLAYWRIGHT= to point at a Playwright install if it is not global.
 */

/* Playwright is installed globally in this environment rather than in the
   project, so it is resolved by path instead of by name. */
const { chromium } = await import(
  process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'

const URL = process.env.URL ?? 'http://localhost:8099/'
const EDGE = 0.35   // the band a tile falls back to, as a share of its height

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
/* Ширины, на которых снимается. Крайние — телефон в одну колонку и широкий
   монитор; средняя — та, где сетка стоит тремя колонками и кроп самый узкий. */
const WIDTHS = [390, 1024, 1560]
const context = await browser.newContext({ viewport: { width: WIDTHS.at(-1), height: 1000 } })
/* Every tile the block can show, not only the ones it shows by default —
   otherwise a photograph that appears at eight tiles is never measured. */
await context.addInitScript(() => {
  try { localStorage.setItem('cbdin:nested:lookCount', '8') } catch { /* private mode */ }
})
const page = await context.newPage()
await page.goto(URL, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
/* lazy images below the fold decode only once they are scrolled to, and an
   undecoded image draws as nothing — which measures as pure black */
for (const y of [0.3, 0.6, 0.9]) {
  await page.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), y)
  await page.waitForTimeout(400)
}
await page.evaluate(() => Promise.all(
  [...document.querySelectorAll('[data-tile] img')].map((i) => i.decode().catch(() => {}))))
await page.waitForTimeout(600)

/* Один проход по тем плиткам, что нашлись селектором.
   Возвращает не яркость, а координаты: где на снимке лежат буквы подписи.
   Сами пиксели читаются снаружи, из снимка страницы, — в браузере их взять
   неоткуда, потому что снимок под вуалью нарисован не нами. */
const boxesOf = (page, selector) => page.evaluate(async (sel) => {
  const out = {}
  for (const tile of document.querySelectorAll(sel)) {
    const img = tile.querySelector('img')
    if (!img || !img.complete || !img.naturalWidth) continue
    const body = tile.querySelector('[class*="body"]')
    if (!body) continue
    /* коробка именно букв, а не всей подписи: подпись включает растушёвку
       сверху, под которой текста нет и мерить там нечего */
    const lines = [...body.querySelectorAll('b, h3, small, span')]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    const boxes = (lines.length ? lines : [body]).map((e) => e.getBoundingClientRect())
    const x = Math.min(...boxes.map((b) => b.left))
    const y = Math.min(...boxes.map((b) => b.top))
    const r = Math.max(...boxes.map((b) => b.right))
    const bt = Math.max(...boxes.map((b) => b.bottom))
    if (r - x < 4 || bt - y < 4) continue
    out[tile.getAttribute('data-tile')] = {
      x: x + scrollX, y: y + scrollY, w: r - x, h: bt - y,
    }
  }
  return out
}, selector)

/** Средняя яркость самой светлой пятой части области снимка. */
const brightOf = async (shot, meta, b) => {
  const left = Math.max(0, Math.round(b.x)), top = Math.max(0, Math.round(b.y))
  const width = Math.min(Math.round(b.w), meta.width - left)
  const height = Math.min(Math.round(b.h), meta.height - top)
  if (width < 2 || height < 2) return null
  const px = await sharp(shot).extract({ left, top, width, height })
    .removeAlpha().raw().toBuffer()
  const lums = []
  for (let i = 0; i < px.length; i += 3) {
    const ch = [px[i], px[i + 1], px[i + 2]].map((v) => {
      const t = v / 255
      return t <= 0.04045 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4
    })
    lums.push(0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2])
  }
  lums.sort((a, b2) => b2 - a)
  const top5 = lums.slice(0, Math.max(1, Math.round(lums.length * 0.2)))
  /* Идеально ровный кусок — это не снимок, а фон: значит сняли не то место
     (закрытое меню, плитка, уехавшая за край прокрутки). Такой замер не
     возвращается вовсе, иначе он назначит вуаль по цвету страницы. */
  if (lums[0] - lums.at(-1) < 0.002) return null
  return {
    bright: +(top5.reduce((s, v) => s + v, 0) / top5.length).toFixed(4),
    mean: +(lums.reduce((s, v) => s + v, 0) / lums.length).toFixed(4),
  }
}

/** Снять страницу без вуали и без букв — то есть голые снимки. */
const bareShot = async (page) => {
  await page.evaluate(() => {
    window.__off = []
    for (const t of document.querySelectorAll('[data-tile]')) {
      window.__off.push([t, t.getAttribute('data-shade')])
      t.setAttribute('data-shade', 'off')
      const body = t.querySelector('[class*="body"]')
      /* Атрибута мало: `data-shade='off'` снимает вуаль только у одного типа
         плитки, а мерить голый снимок надо у всех. Инлайн-стиль сильнее
         любого правила и не зависит от того, какой тип у плитки сегодня. */
      if (body) { body.style.color = 'transparent'; body.style.background = 'none' }
    }
  })
  const shot = await page.screenshot({ fullPage: true })
  await page.evaluate(() => {
    for (const [t, was] of window.__off) {
      if (was === null) t.removeAttribute('data-shade'); else t.setAttribute('data-shade', was)
      const body = t.querySelector('[class*="body"]')
      if (body) { body.style.color = ''; body.style.background = '' }
    }
  })
  return shot
}

const readTiles = async (page, selector) => {
  const boxes = await boxesOf(page, selector)
  const shot = await bareShot(page)
  const meta = await sharp(shot).metadata()
  const out = {}
  for (const [key, b] of Object.entries(boxes)) {
    const v = await brightOf(shot, meta, b)
    if (v) out[key] = v
    else console.warn(`  ! ${key} не снялся: коробка ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)} при снимке ${meta.width}×${meta.height}`)
  }
  return out
}

/* The homepage's tiles first, then the menu's — the same six photographs at a
   different crop, which is why they are different numbers. Hovering the nav
   item is the honest way in: the menu's open state is module-local, so
   setting an attribute from outside does not reach it. */
/** Худшее (самое светлое) из нескольких замеров: вуаль считается по нему. */
const worst = (a, b) => {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) {
    out[k] = !out[k] || v.bright > out[k].bright ? v : out[k]
  }
  return out
}

let home = {}
for (const w of WIDTHS) {
  await page.setViewportSize({ width: w, height: 1000 })
  await page.waitForTimeout(500)
  for (const y of [0.3, 0.6, 0.9]) {
    await page.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), y)
    await page.waitForTimeout(300)
  }
  await page.evaluate(() => Promise.all(
    [...document.querySelectorAll('[data-tile] img')].map((i) => i.decode().catch(() => {}))))
  await page.waitForTimeout(300)
  home = worst(home, await readTiles(page, '[data-tile]:not([data-tile^="menu:"])'))
}
await page.setViewportSize({ width: WIDTHS.at(-1), height: 1000 })
await page.waitForTimeout(400)
await page.evaluate(() => window.scrollTo(0, 0))
await page.getByRole('link', { name: 'By benefit' }).first().hover()
await page.waitForSelector('[data-tile="menu:pets"] img')
await page.evaluate(() => Promise.all(
  [...document.querySelectorAll('[data-tile^="menu:"] img')].map((i) => i.decode().catch(() => {}))))
await page.waitForTimeout(400)
const menu = await readTiles(page, '[data-tile^="menu:"]')
const measured = { ...home, ...menu }

await browser.close()

const rows = Object.entries(measured).sort()
for (const [k, v] of rows) console.log(k.padEnd(10), 'bright', v.bright, ' mean', v.mean)

writeFileSync('lib/bright.ts', `/**
 * How bright each photograph is where its caption sits.
 *
 * GENERATED by tools/shade.mjs — do not edit. Re-run the script whenever a
 * picture changes:  node tools/shade.mjs  (with the site served on :8099).
 *
 * The value is the mean relative luminance of the brightest fifth of the
 * caption band, on a 0–1 scale: a bright-patch reading, because white text
 * fails on the bright spots it crosses and not on the average of the frame.
 * Keys are the tile's own id, so two blocks showing the same file under
 * different crops are measured separately.
 *
 * Only the measurement lives here. Turning it into a veil alpha is done in
 * lib/shade.ts, by hand, so the target can move without measuring again —
 * and so a re-run cannot overwrite the arithmetic, which is exactly what it
 * used to do.
 */

export const BRIGHT: Record<string, number> = {
${rows.map(([k, v]) => `  '${k}': ${v.bright},`).join('\n')}
}
`)
console.log('\nwrote lib/bright.ts')
