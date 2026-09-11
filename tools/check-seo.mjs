/**
 * Разметка для поиска — по собранному `out/`, без браузера.
 *
 * Это измеримая половина двух чужих скиллов про СЕО (Addy Osmani,
 * `web-quality-skills/seo`; AgriciDaniel, `claude-seo`), разобранных в
 * `docs/skills.md`. Сами скиллы в проект не ставятся: они про живой сайт и
 * чужой рантайм. Их правила, которые видны в файле, — здесь, и живут в CI,
 * ни от чьей памяти не завися. Остальное просыпается на этапе сдачи — см.
 * `tools/stages.mjs`.
 *
 * Меряется то, что читает обходчик: не отрисованная страница, а HTML как
 * он отдан. Именно эту подачу видит поиск, и именно в ней ломается СЕО.
 *
 *   lang         — у страницы есть язык, и он тот, что в адресе
 *   title        — заголовок есть и не повторяет чужой на том же языке
 *   description  — описание есть и не повторяет чужое
 *   canonical    — страница для поиска ссылается на себя, а не на соседа
 *   hreflang     — сетка языков полная: на себя, x-default, и обратно
 *   viewport     — мета окна с width=device-width
 *   og           — заголовок и описание для предпросмотра ссылки
 *                  (мессенджеры — канал заказа, ссылка без карточки
 *                  теряет покупателя до того, как он её открыл)
 *   ld           — JSON-LD разбирается и знает свой @type
 *   alt          — у снимка есть alt (пустой — тоже alt: снимок украшение)
 *   sample       — заглушка ([COMPANY], [PHONE]) в том, что читает машина
 *   robots       — robots.txt и карта сайта собраны, robots называет карту
 *
 * Чего здесь НЕТ, потому что уже есть в другом месте: существование
 * обещанных адресов — `check:urls`; лестница заголовков и один `h1` —
 * семья `heads` в `check:craft`. Второй ответ на «где это решается?» —
 * заплатка.
 *
 * Храповик: база в `tools/seo-baseline.json`. Падает, только если стало
 * БОЛЬШЕ. На этапе сдачи все семьи обязаны быть на нуле — это ворота
 * этапа 5 в `tools/stages.mjs`.
 *
 *   npm run build:site && node tools/check-seo.mjs
 *   node tools/check-seo.mjs --update       записать нынешние числа базой
 *   node tools/check-seo.mjs --list [семья] показать сами находки
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { LOCALES, DEFAULT_LANG } from './routes.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'out')
const BASELINE = join(ROOT, 'tools/seo-baseline.json')

if (!existsSync(OUT)) {
  console.error('\n✗ Нет out/. Сначала: npm run build:site')
  process.exit(1)
}

/* Словарь языка рынка — чтобы увидеть в разметке английский источник там,
   где должен стоять перевод. Читается текстом, как `routes.mjs` читает
   локали: импорт `.ts` из `.mjs` тянет за собой снятие типов и предупреждение
   Node на каждый прогон в CI. Словаря может не быть — набор ставится и в
   одноязычные проекты, — и тогда семья `market` просто пуста.

   Но словарь, который ЕСТЬ и не разобрался, — это ослепшая проверка,
   выглядящая как зелёная. Разбор регуляркой держится на том, как словарь
   набран: сменится кавычка у ключей — и сито опустеет молча, а семья
   перестанет ловить что-либо, оставшись на нуле в базе. Поэтому пустой
   разбор существующего словаря валит проверку, как пустой список страниц. */
const DICT = (() => {
  const path = join(ROOT, 'lib/dict.ts')
  if (!existsSync(path)) return null
  /* Только тело объекта BG: комментарии и соседние объекты в сито не идут. */
  const src = readFileSync(path, 'utf8').split(/export const BG[^{]*\{/)[1]?.split(/\n\}/)[0] ?? ''
  const out = {}
  const pair = /(?:'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*))\s*:\s*(?:\/\*[\s\S]*?\*\/\s*)?'((?:[^'\\]|\\.)*)'/g
  for (const m of src.matchAll(pair)) out[(m[1] ?? m[2]).replace(/\\'/g, "'")] = m[3].replace(/\\'/g, "'")
  if (Object.keys(out).length < 50) {
    console.error(`\n✗ ${relative(ROOT, path)} есть, а разобрать из него удалось ${Object.keys(out).length} пар.`)
    console.error('  Семья market мерит английский в разметке словарём; пустое сито — сломанный')
    console.error('  разбор, а не отсутствие дефектов. Починить регулярку в tools/check-seo.mjs.')
    process.exit(1)
  }
  return out
})()

/* ── страницы: `out/bg/cart.html` → `/bg/cart` ──────────────────────────── */
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
      /* Служебные листы фреймворка адресами не являются. */
      if (/^\/(404|_not-found)$/.test(bare)) continue
      pages.set(bare, path)
    }
  }
}

/* ── разбор тегов: регулярка, а не DOM — имена атрибутов React пишет как
   `hrefLang`, поэтому ключи приводятся к нижнему регистру ───────────────── */
const attrs = (tag) => {
  const o = {}
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    o[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return o
}
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => attrs(m[0]))
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/** Язык адреса: `/bg/catalog` → `bg`; сайт без языков → ''. */
const langOf = (url) => {
  const first = url.split('/')[1] ?? ''
  return LOCALES.includes(first) ? first : ''
}

/* Свой адрес сайта — из карты сайта, иначе из первого canonical. */
const sitemapPath = join(OUT, 'sitemap.xml')
const sitemap = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : ''
let SITE = (sitemap.match(/<loc>([^<]*)<\/loc>/)?.[1] ?? '').replace(/^(https?:\/\/[^/]+).*$/, '$1')
const norm = (u) => (u.replace(/\/+$/, '') || '/')
const local = (href) => {
  if (!href) return null
  if (SITE && href.startsWith(SITE)) return norm(href.slice(SITE.length) || '/')
  if (href.startsWith('/')) return norm(href)
  return null
}

const PLACEHOLDER = /\[[A-Z][A-Z _]{2,}\]/g
const CODE = /^(x-default|[a-z]{2,3}(-[A-Za-z]{4})?(-[A-Z]{2})?)$/

const found = {
  lang: [], title: [], description: [], canonical: [], hreflang: [], viewport: [], og: [],
  ld: [], alt: [], sample: [], robots: [], market: [], faqPage: [],
}

/* ── сито для семьи `market` ───────────────────────────────────────────────
 *
 * Правило заказчика: основные страницы — на языке рынка, и в поиск они
 * уходят на нём же. Значит на странице языка рынка английского источника в
 * машинном тексте быть не может: если он там, перевод не сработал.
 *
 * Сито — сам словарь: ключи, у которых перевод ОТЛИЧАЕТСЯ от источника.
 * Ключ, переведённый сам в себя («5%», «CBD»), ничего не доказывает. Коротким
 * ключам веры нет по другой причине: «ml» и «mg» стоят в болгарском тексте
 * законно, цифры и единицы в обоих языках одни.
 *
 * Длинные ключи проверяются раньше коротких: находка печатается одна на
 * строку, и пусть это будет самое длинное совпадение — по нему видно место. */
const LEAK = Object.entries(DICT ?? {})
  .filter(([en, bg]) => en !== bg && /[A-Za-z]{3}/.test(en) && en.length >= 5)
  .map(([en]) => en)
  .sort((a, b) => b.length - a.length)
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/* Границей слова служит не `\b`: дефис и подчёркивание внутри имени — часть
   слова, а `\b` рвёт их и даёт совпадение в середине чужого слова. */
const leakIn = (text) => LEAK.find((en) => new RegExp(`(^|[^\\w-])${escRe(en)}($|[^\\w-])`).test(text))

/** Человекочитаемые строки из разметки: имя, описание, значение свойства.
    Адреса, идентификаторы и снимки не переводятся и потому не считаются. */
const TEXT_KEYS = new Set(['name', 'description', 'headline', 'alternateName', 'caption', 'text', 'value'])
const ldStrings = (node, out = []) => {
  if (Array.isArray(node)) { for (const x of node) ldStrings(x, out); return out }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (TEXT_KEYS.has(k) && typeof v === 'string') out.push(v)
      else ldStrings(v, out)
    }
  }
  return out
}

/* ── сайт целиком ──────────────────────────────────────────────────────── */
const robotsPath = join(OUT, 'robots.txt')
if (!existsSync(robotsPath)) found.robots.push('robots.txt не собран')
else if (!/^\s*Sitemap:/mi.test(readFileSync(robotsPath, 'utf8'))) found.robots.push('robots.txt не называет карту сайта (строка Sitemap:)')
if (!sitemap) found.robots.push('sitemap.xml не собран')
else if (!/<loc>/.test(sitemap)) found.robots.push('sitemap.xml пуст')

/* ── первый проход: что говорит каждая страница ────────────────────────── */
const info = new Map()
for (const [url, path] of [...pages].sort()) {
  const html = readFileSync(path, 'utf8')
  if (!SITE) SITE = (html.match(/<link[^>]*rel="canonical"[^>]*href="(https?:\/\/[^/"]+)/i)?.[1] ?? '')
  const metas = tags(html, 'meta')
  const links = tags(html, 'link')
  const meta = (n) => metas.find((m) => m.name?.toLowerCase() === n)?.content
  const prop = (p) => metas.find((m) => m.property?.toLowerCase() === p)?.content
  info.set(url, {
    lang: attrs(html.match(/<html\b[^>]*>/i)?.[0] ?? '').lang ?? '',
    title: decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').trim(),
    description: decode(meta('description') ?? '').trim(),
    noindex: /noindex/i.test(meta('robots') ?? ''),
    viewport: meta('viewport') ?? '',
    canonical: links.find((l) => l.rel?.toLowerCase() === 'canonical')?.href,
    alternates: links
      .filter((l) => l.rel?.toLowerCase() === 'alternate' && l.hreflang)
      .map((l) => ({ code: l.hreflang, to: local(l.href), href: l.href })),
    og: { title: prop('og:title') ?? '', description: prop('og:description') ?? '' },
    lds: [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]),
    imgs: tags(html, 'img'),
    /* Сколько вопросов НАРИСОВАНО. Сравнивается с числом вопросов в
       разметке: расхождение значит, что кто-то вернул `.slice()` в компонент
       и страница обещает поиску ответы, которых на ней нет. */
    details: (html.match(/<details\b/gi) ?? []).length,
  })
}

/* ── второй проход: проверки ───────────────────────────────────────────── */
const dupTitle = new Map(), dupDesc = new Map()
for (const [url, p] of info) {
  const lang = langOf(url)

  if (!p.lang) found.lang.push(`${url} — у <html> нет lang`)
  else if (lang && p.lang.split('-')[0] !== lang) found.lang.push(`${url} — lang="${p.lang}", а адрес говорит «${lang}»`)

  if (!p.title) found.title.push(`${url} — нет <title>`)
  if (!p.description) found.description.push(`${url} — нет meta description`)
  if (!/width=device-width/i.test(p.viewport)) found.viewport.push(`${url} — нет meta viewport с width=device-width`)

  /* Повторы считаются среди страниц ДЛЯ ПОИСКА одного языка: два одинаковых
     заголовка на bg и en — это перевод, а не двойник. */
  if (!p.noindex) {
    for (const [map, key, fam] of [[dupTitle, p.title, 'title'], [dupDesc, p.description, 'description']]) {
      if (!key) continue
      const k = `${lang}\n${key}`
      if (map.has(k)) found[fam].push(`${url} — ${fam} тот же, что у ${map.get(k)}: «${key.slice(0, 60)}»`)
      else map.set(k, url)
    }

    const to = local(p.canonical)
    if (!p.canonical) found.canonical.push(`${url} — нет canonical`)
    else if (to !== null && to !== norm(url)) found.canonical.push(`${url} — canonical указывает на ${to}, а не на себя`)

    if (!p.og.title) found.og.push(`${url} — нет og:title`)
    if (!p.og.description) found.og.push(`${url} — нет og:description`)

    /* Сетка языков. Правила — из seo-hreflang (claude-seo) и Google:
       без ссылки на себя весь набор игнорируется; без обратной ссылки —
       игнорируется пара; x-default один и есть. Существование адреса
       здесь не проверяется — это `check:urls`. */
    for (const a of p.alternates) {
      if (!CODE.test(a.code)) found.hreflang.push(`${url} — hreflang="${a.code}" — недопустимый код (ISO 639-1[-Script][-REGION] или x-default)`)
    }
    if (LOCALES.length > 1 || p.alternates.length) {
      const self = p.alternates.some((a) => a.code !== 'x-default' && a.to === norm(url))
      if (!self) found.hreflang.push(`${url} — hreflang не ссылается на себя`)
      const xd = p.alternates.filter((a) => a.code === 'x-default')
      if (xd.length !== 1) found.hreflang.push(`${url} — hreflang x-default: ${xd.length} (нужен ровно один)`)
      for (const a of p.alternates) {
        if (a.code === 'x-default' || a.to === null || a.to === norm(url)) continue
        const other = info.get(a.to)
        if (!other) continue
        if (!other.alternates.some((b) => b.to === norm(url))) {
          found.hreflang.push(`${url} → hreflang ${a.code} ${a.to} — оттуда обратной ссылки нет`)
        }
      }
    }
  }

  /* ── FAQPage: одна на страницу, и обещает ровно то, что нарисовано ──────
   *
   * Две `FAQPage` на одной странице противоречат друг другу, а не отвечают
   * дважды. А число вопросов в разметке обязано совпадать с числом
   * нарисованных: `.slice(0, 5)` в компоненте выглядит на экране так же, как
   * скрытие лишних таблицей стилей, — и вычёркивает половину ответов из HTML,
   * оставив их в разметке. Дефект, за который заплачено у соседей: страница
   * обещала поиску текст, которого на ней нет. */
  {
    const faqs = []
    for (const text of p.lds) {
      let data
      try { data = JSON.parse(text) } catch { continue }
      for (const n of (Array.isArray(data) ? data : data['@graph'] ?? [data])) {
        if (n && n['@type'] === 'FAQPage') faqs.push(n)
      }
    }
    if (faqs.length > 1) found.faqPage.push(`${url} — FAQPage на странице ${faqs.length}, нужна одна`)
    const asked = faqs.reduce((n, f) => n + (f.mainEntity?.length ?? 0), 0)
    if (faqs.length && asked !== p.details) {
      found.faqPage.push(`${url} — в разметке вопросов ${asked}, в разметке страницы <details> ${p.details}`)
    }
  }

  for (const [i, text] of p.lds.entries()) {
    let data
    try { data = JSON.parse(text) } catch (e) {
      found.ld.push(`${url} — JSON-LD #${i + 1} не разбирается: ${e.message.slice(0, 60)}`)
      continue
    }
    const nodes = Array.isArray(data) ? data : data['@graph'] ?? [data]
    for (const n of nodes) {
      if (!n || typeof n !== 'object' || !n['@type']) found.ld.push(`${url} — JSON-LD #${i + 1}: узел без @type`)
    }
    if (!Array.isArray(data) && !data['@context']) found.ld.push(`${url} — JSON-LD #${i + 1}: нет @context`)
  }

  for (const img of p.imgs) {
    if (!('alt' in img)) found.alt.push(`${url} — <img src="${(img.src ?? '').slice(0, 50)}"> без alt`)
  }

  /* Заглушка в том, что читает машина: заголовок, описание, разметка.
     На витрине её ловит `check:craft`; здесь — то, что уедет в выдачу. */
  for (const [what, text] of [['title', p.title], ['description', p.description], ['og', p.og.title + ' ' + p.og.description], ['JSON-LD', p.lds.join(' ')]]) {
    const hits = [...new Set(text.match(PLACEHOLDER) ?? [])]
    if (hits.length) found.sample.push(`${url} — заглушка в ${what}: ${hits.join(', ')}`)
  }

  /* Страница языка рынка говорит машине на языке рынка. Перевод применяется
     на сборке и по ключу целиком — а склеенная строка ключом не бывает и
     уезжает в выдачу как есть, молча. Глазом этого не увидеть: на странице
     стоит перевод, и только в отданном файле разметка говорит по-английски. */
  if (LEAK.length && lang === DEFAULT_LANG && !p.noindex) {
    const machine = [
      ['title', p.title], ['description', p.description],
      ['og:title', p.og.title], ['og:description', p.og.description],
      ...p.lds.flatMap((t) => {
        let data
        try { data = JSON.parse(t) } catch { return [] }
        return ldStrings(data).map((x) => ['JSON-LD', x])
      }),
    ]
    for (const [what, text] of machine) {
      const en = text && leakIn(text)
      if (en) found.market.push(`${url} — ${what} по-английски: «${en}» в «${text.slice(0, 70)}»`)
    }
  }
}

/* ── итог: храповик ────────────────────────────────────────────────────── */
const counts = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length]))

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n')
  console.log('База обновлена:', counts)
  process.exit(0)
}

const NAMES = {
  lang: 'язык страницы: нет lang или не тот, что в адресе',
  title: '<title>: нет или повторяет чужой на том же языке',
  description: 'meta description: нет или повторяет чужое',
  canonical: 'canonical: нет или указывает не на себя',
  hreflang: 'hreflang: не на себя, без x-default, без обратной ссылки или с кривым кодом',
  viewport: 'meta viewport без width=device-width',
  og: 'og:title / og:description — нет предпросмотра ссылки',
  ld: 'JSON-LD не разбирается или без @type / @context',
  alt: '<img> без alt (пустой alt — это тоже ответ)',
  sample: 'заглушка в том, что читает машина: title, description, og, JSON-LD',
  robots: 'robots.txt / sitemap.xml не собраны или не связаны',
  faqPage: 'FAQPage: их больше одной или обещано ответов больше, чем нарисовано',
  market: `страница языка рынка (${DEFAULT_LANG}) отдаёт машине английский источник — перевод не сработал`,
}

const li = process.argv.indexOf('--list')
if (li !== -1) {
  const pick = process.argv[li + 1]
  const fams = found[pick] ? [pick] : Object.keys(NAMES)
  for (const k of fams) {
    console.log(`\n${NAMES[k]} — ${found[k].length}`)
    for (const l of found[k]) console.log(`    ${l}`)
  }
  process.exit(0)
}

let base
try {
  base = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
  console.error(`Нет ${relative(ROOT, BASELINE)}. Создать: npm run check:seo -- --update`)
  process.exit(1)
}

let failed = false
for (const key of Object.keys(NAMES)) {
  const now = counts[key], was = base[key] ?? 0
  if (now > was) {
    failed = true
    console.error(`\n✗ ${NAMES[key]}: было ${was}, стало ${now}`)
    for (const l of found[key].slice(-(now - was) * 3)) console.error(`    ${l}`)
  } else if (now < was) {
    console.log(`✓ ${NAMES[key]}: ${was} → ${now}`)
  } else {
    console.log(`· ${NAMES[key]}: ${now}`)
  }
}

if (failed) {
  console.error('\nНарушений стало больше. Либо чините, либо — если это осознанное')
  console.error('решение — обновляйте базу: npm run check:seo -- --update')
  process.exit(1)
}

const total = Object.values(counts).reduce((a, b) => a + b, 0)
const wasTotal = Object.values(base).reduce((a, b) => a + b, 0)
if (total < wasTotal) console.log(`\nДолг сократился: ${wasTotal} → ${total}. Обновите базу.`)
console.log(`· разметка для поиска: ${info.size} страниц, ${LOCALES.length || 1} язык(а)`)
