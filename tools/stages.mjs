/**
 * Этапы производства сайта — реестр.
 *
 * Заведён по дефекту, и дефект был про память. У проекта набралось три
 * десятка скиллов, и половина из них нужна не сейчас: скилл про поиск
 * (СЕО) на этапе вёрстки отвечает на незаданный вопрос, а на этапе сдачи
 * без него нельзя. Заказчик сказал ровно это: «сейчас не нужно, а к финалу
 * понадобится — и я его забуду».
 *
 * Забудет не заказчик, а сессия: у неё нет вчера. Переживают конец сессии
 * две вещи — файл, который читается раньше кода, и проверка, которая валит
 * сборку. Поэтому этап — это СТРОКА в `CLAUDE.md`, а что на этом этапе
 * работает, что ждёт и что должно держаться — таблица здесь, и её читает
 * `tools/stage.mjs`.
 *
 * Скиллы друг друга не зовут: каждый выбирается моделью по своему описанию.
 * Значит «включить скилл на этапе 5» буквально невозможно — но можно:
 *   · записать в реестр, на каком этапе он просыпается и что из него брать;
 *   · печатать это в начале каждой сессии (`npm run stage`);
 *   · превратить измеримую его половину в проверку, которая живёт в CI и
 *     не нуждается ни в чьей памяти.
 *
 * Ворота этапа — не «сделано ли», а «держится ли». Пройденные ворота
 * обязаны держаться дальше: шкала, заведённая на этапе 0, не может исчезнуть
 * на этапе 3. Это и проверяет `npm run check:stage` — храповик по этапам.
 *
 * Порядок этапов — порядок ВОРОТ, а не работ. Наполнение (4) приходит от
 * заказчика и идёт параллельно вёрстке; но сдать (5) раньше, чем данные
 * стали настоящими, нельзя — вот что значит «4 раньше 5».
 *
 * Реестр переносится в новый проект как есть. Предикаты ниже смотрят на
 * файлы и на соглашения набора (шкалы, примитивы, базы храповиков, флаги
 * `*_IS_REAL`), а не на cbdin.bg: то, чего в новом проекте нет, честно
 * названо «нет», а не «не нужно».
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = new URL('..', import.meta.url).pathname

/* ── что видит предикат ────────────────────────────────────────────────── */

const has = (p) => existsSync(join(ROOT, p))
const src = (p) => (has(p) ? readFileSync(join(ROOT, p), 'utf8') : '')
const json = (p) => { try { return JSON.parse(src(p)) } catch { return null } }
const pkg = () => json('package.json') ?? { scripts: {} }
const script = (name) => Boolean(pkg().scripts?.[name])

/** Есть ли процесс CI, который зовёт хотя бы храповик по вёрстке. Имя файла
 *  не важно: `check.yml`, `ci.yml` — важно, что сборка падает сама. */
const ci = () => {
  const dir = join(ROOT, '.github/workflows')
  if (!existsSync(dir)) return false
  return readdirSync(dir).some((f) => /check:css/.test(readFileSync(join(dir, f), 'utf8')))
}

/** Все файлы `lib/` — там живут данные и их флаги. */
function libFiles() {
  const out = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path)
    }
  }
  walk(join(ROOT, 'lib'))
  return out
}

/** Флаги настоящести — соглашение набора: факт, который пока образец, стоит
 *  за выключателем `export const ЧТО_IS_REAL = false` (или `_ARE_REAL`).
 *  Его спрашивает всё, что не имеет права врать машине: разметка, карта
 *  сайта, кнопка заказа. Наполнение считается пришедшим, когда все они
 *  стали `true`. */
export function realFlags() {
  const flags = []
  for (const path of libFiles()) {
    const text = readFileSync(path, 'utf8')
    for (const m of text.matchAll(/export const (\w+_(?:IS|ARE)_REAL)\s*=\s*(true|false)/g)) {
      flags.push({ name: m[1], on: m[2] === 'true', file: path.slice(ROOT.length) })
    }
  }
  return flags
}

/** Заглушки в данных: `[PHONE]`, `[COMPANY]`, `[BGXXXXXXXXX]`. Признак
 *  тот же, что у семьи `placeholder` в `check:craft`, только по исходнику,
 *  а не по отрисованной витрине: здесь браузер не нужен. */
export function placeholders() {
  const count = {}
  for (const path of libFiles()) {
    for (const m of readFileSync(path, 'utf8').matchAll(/\[[A-Z][A-Z _]{2,}\]/g)) {
      count[m[0]] = (count[m[0]] ?? 0) + 1
    }
  }
  return count
}

/** База храповика на нуле по названным семьям — или по всем. */
const clean = (baseline, families) => {
  const base = json(baseline)
  if (!base) return null
  const keys = families ?? Object.keys(base)
  return keys.filter((k) => (base[k] ?? 0) > 0)
}

/* ── этапы ─────────────────────────────────────────────────────────────── */

/**
 * Каждый этап: что строится, кто работает, чем меряется, ворота, что ждёт
 * своего дня.
 *
 *   machine — предикаты: `() => null | 'что не так'`. Это те ворота,
 *             которые проверка держит сама, без памяти.
 *   human   — то, что меряется глазом заказчика или снаружи. Печатается
 *             списком, чтобы было что отметить; проверка это не считает.
 *   parked  — чужие скиллы и инструменты, которые просыпаются здесь.
 *             Записаны адресом и тем, ЧТО из них брать: не «поставить
 *             скилл», а «взять справочник X как сверочный лист для Y».
 */
export const STAGES = [
  {
    n: 0, name: 'Основание',
    builds: 'три шкалы (цвет, размер, ритм), пять примитивов раскладки, три брейкпоинта, правила в CLAUDE.md и проверки-храповики — с первого коммита, до первого блока.',
    skills: ['craft', 'code', 'stages'],
    checks: ['typecheck', 'check:css', 'check:code', 'check:lint', 'test', 'check:stage'],
    gate: {
      machine: [
        () => has('CLAUDE.md') ? null : 'нет CLAUDE.md — правила не читаются раньше кода',
        () => /--fs-/.test(src('styles/tokens.css')) ? null : 'шкалы размера --fs-* нет в styles/tokens.css — правило 1 ссылается в пустоту',
        () => /--sp-/.test(src('styles/tokens.css')) ? null : 'шкалы ритма --sp-* нет в styles/tokens.css — правило 2 ссылается в пустоту',
        () => {
          const p = src('styles/primitives.module.css')
          const missing = ['stack', 'cluster', 'switcher', 'rail', 'prose'].filter((c) => !new RegExp(`\\.${c}\\b`).test(p))
          return missing.length ? `примитивов раскладки нет: ${missing.join(', ')} (styles/primitives.module.css)` : null
        },
        () => script('check:css') && has('tools/css-baseline.json') ? null : 'храповика по вёрстке нет (check:css + tools/css-baseline.json)',
        () => script('check:code') && has('tools/code-baseline.json') ? null : 'храповика по коду нет (check:code + tools/code-baseline.json)',
        () => ci() ? null : 'проверки не валят сборку сами — в .github/workflows/ нет процесса, который зовёт check:css',
      ],
      human: [
        'брейкпоинтов ровно три — 1080, 820, 560 — и каждый назван в CLAUDE.md',
        'роли цвета названы по работе (--page, --ink, --accent), а не по оттенку',
      ],
    },
    parked: [
      { name: 'ui-ux-pro-max --design-system', url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
        take: 'только на НОВОМ сайте, где системы ещё нет: режим выбора стиля и палитры в день первый. В проекте с tokens.css не ставится — второй набор чисел.' },
      { name: 'minimalist · brutalist · soft (taste-skill)', url: '.claude/skills/',
        take: 'за идеей стиля, не за числами: идея переводится в свои токены.' },
    ],
  },
  {
    n: 1, name: 'Каркас',
    builds: 'адреса и дерево маршрутов, язык адресом (/bg, /en), данные одной таблицей в lib/, карта сайта и robots как МЕХАНИЗМ, один факт о товаре — одно место.',
    skills: ['code', 'craft', 'stages'],
    checks: ['typecheck', 'check:open', 'build:site', 'check:urls', 'check:stage'],
    gate: {
      machine: [
        () => has('tools/routes.mjs') ? null : 'дерева маршрутов нет (tools/routes.mjs) — список страниц будет набираться рукой',
        () => has('app') ? null : 'нет app/ — маршрутов ещё нет',
        () => has('app/sitemap.ts') || has('app/sitemap.xml') || has('public/sitemap.xml') ? null : 'карты сайта нет как механизма (app/sitemap.ts)',
        () => has('app/robots.ts') || has('public/robots.txt') ? null : 'robots нет как механизма (app/robots.ts)',
        () => script('check:open') && script('check:urls') ? null : 'проверок адресов нет (check:open, check:urls)',
      ],
      human: [
        'каждый факт о товаре живёт в одном месте (lib/), витрина его спрашивает, а не набирает второй раз',
        'служебные страницы (корзина, оформление, 404) названы одним списком и сами говорят о себе noindex',
        'если сайт не одноязычный — язык это адрес, а не состояние браузера',
      ],
    },
    parked: [],
  },
  {
    n: 2, name: 'Вёрстка',
    builds: 'блоки и страницы, отзывчивость по ширинам, обе темы, вкус и движение. Компонент меряет контейнер, а не окно; число колонок вычисляется.',
    skills: ['craft', 'code', 'taste-skill', 'emil-design-eng', 'impeccable', 'improve-animations', 'redesign-skill', 'stages'],
    checks: ['typecheck', 'check:css', 'check:code', 'check:lint', 'test', 'check:open', 'build:site', 'check:urls', 'check:seo', 'check:craft', 'sweep', 'check:stage'],
    gate: {
      machine: [
        () => script('check:craft') && has('tools/craft-baseline.json') ? null : 'храповика по отрисованной странице нет (check:craft + tools/craft-baseline.json)',
        () => script('sweep') ? null : 'свипа по ширинам нет (sweep)',
        () => {
          const bad = clean('tools/css-baseline.json', ['fontPx', 'spacingPx', 'breakpoint', 'ratioNoCap'])
          return bad === null ? 'базы check:css не прочитать' : bad.length ? `четыре запрета вёрстки не на нуле: ${bad.join(', ')}` : null
        },
      ],
      human: [
        'свип 320…1600 показан заказчику: без горизонтального переполнения и без скачков высоты',
        'заказчик посмотрел витрину глазом и не нашёл дефекта — а найденное стало правилом в скилле',
        'вычитан живой список Vercel по изменённым файлам (шаг 4 порядка работы craft)',
      ],
    },
    parked: [
      { name: 'Живой список Vercel — вычитывать перед сдачей вёрстки', url: 'https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md',
        take: 'список меняется у авторов; копировать его к себе нельзя — устареет. Читается целиком по изменённым файлам. Последняя вычитка: сентябрь, нашла три дефекта (фокус под шапкой при ходьбе табом, задержка нажатия на телефоне, цифры не равной ширины в столбцах) — все починены слоем, а не местом.' },
    ],
  },
  {
    n: 3, name: 'Поведение',
    builds: 'корзина, фильтры, формы, состояния (пусто, ошибка, ожидание), склады памяти браузера, панель настроек. Функция обновления состояния чиста; компонент помнит одно.',
    skills: ['code', 'craft', 'systematic-debugging', 'test-driven-development', 'stages'],
    checks: ['typecheck', 'check:code', 'check:lint', 'test', 'check:open', 'build:site', 'check:urls', 'check:craft', 'check:stage'],
    gate: {
      machine: [
        () => {
          const bad = clean('tools/code-baseline.json', ['keep'])
          return bad === null ? 'базы check:code не прочитать' : bad.length ? 'память браузера идёт мимо склада (семья keep не на нуле)' : null
        },
        /* Линтер и прогон тестов — не набор, а проект: набор их не везёт,
           потому что они зависят от движка. Но без них поведение не
           сдаётся: мёртвый импорт и функция без проверки живут до первого
           покупателя. */
        () => script('lint') ? null : 'линтера нет (npm run lint) — мёртвые импорты никто не считает',
        () => script('test') ? null : 'прогона тестов нет (npm test) — test-driven-development ссылается в пустоту',
      ],
      human: [
        'каждое действие покупателя отвечает: нажатие видно, ошибка названа, пустое состояние нарисовано',
        'сканер React Doctor прогнан по изменённому, находки уровня «ошибка» разобраны',
        'долг check:code (повторы, длинные файлы, перегруженные компоненты) не вырос, а лучше — сократился',
      ],
    },
    parked: [
      { name: 'React Doctor в сборку', url: 'https://ui-skills.com',
        take: 'ставить в CI с порогом «не хуже, чем сегодня», когда находок уровня «ошибка» ноль.' },
    ],
  },
  {
    n: 4, name: 'Наполнение',
    builds: 'настоящие тексты, снимки с подписями, реквизиты фирмы, каналы связи, отзывы — от заказчика. Флаги настоящести переключаются в true; заглушки уходят с витрины.',
    skills: ['stages', 'craft'],
    checks: ['test', 'build:site', 'check:craft', 'check:seo', 'check:stage'],
    gate: {
      machine: [
        () => {
          const off = realFlags().filter((f) => !f.on)
          return off.length ? `данные ещё образцы: ${off.map((f) => `${f.name} (${f.file})`).join(', ')}` : null
        },
        () => {
          const ph = placeholders()
          const list = Object.entries(ph).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`)
          return list.length ? `заглушки в данных: ${list.join(', ')}` : null
        },
        () => {
          const bad = clean('tools/craft-baseline.json', ['placeholder'])
          return bad === null ? 'базы check:craft не прочитать' : bad.length ? 'семья placeholder в check:craft не на нуле — заглушки на витрине' : null
        },
      ],
      human: [
        'у каждого снимка подпись alt от заказчика, а не от исполнителя',
        'ни одного здравного утверждения на витрине — намеренно',
        'открытые вопросы наполнения в docs/open.md закрыты словом заказчика',
      ],
    },
    parked: [
      { name: 'seo-content (claude-seo) — E-E-A-T и чистка ИИ-фраз', url: 'https://github.com/AgriciDaniel/claude-seo',
        take: 'тексты — работа заказчика; но перед тем как принять текст на витрину, его можно прогнать: «читается ли как написанное человеком, есть ли кто за ним стоит». Совет, не проверка.' },
    ],
  },
  {
    n: 5, name: 'Сдача',
    builds: 'то, что включают только на настоящем: карта сайта и robots открыты поиску, разметка товара с ценой и наличием, бюджет веса, скорость, доступность, внешний аудит по проду.',
    skills: ['stages', 'craft', 'code', 'verification-before-completion'],
    checks: ['typecheck', 'check:css', 'check:code', 'check:lint', 'test', 'check:open', 'build:site', 'check:urls', 'check:seo', 'check:craft', 'sweep', 'check:stage'],
    gate: {
      machine: [
        () => has('out') ? null : 'сайт не собран — npm run build:site',
        () => /Sitemap:/i.test(src('out/robots.txt')) ? null : 'out/robots.txt не называет карту сайта',
        () => /<loc>/.test(src('out/sitemap.xml')) ? null : 'out/sitemap.xml пуст',
        () => {
          const bad = clean('tools/seo-baseline.json')
          return bad === null ? 'базы check:seo не прочитать' : bad.length ? `check:seo не на нуле: ${bad.join(', ')} — перед сдачей долга по разметке быть не должно` : null
        },
        () => {
          const bad = clean('tools/craft-baseline.json', ['contrast', 'target', 'name', 'focus', 'theme'])
          return bad === null ? 'базы check:craft не прочитать' : bad.length ? `доступность не на нуле в check:craft: ${bad.join(', ')}` : null
        },
      ],
      human: [
        'PageSpeed Insights / Lighthouse по проду: LCP, CLS, INP зелёные на телефоне',
        'Rich Results Test на странице товара: Product с Offer читается без ошибок',
        'внешний аудит по проду: claude-seo (/seo audit, /seo schema, /seo hreflang, /seo technical) — находки разобраны',
        'бюджет веса страницы: скрипты, стили, снимки первого экрана — замерены по отданному и сжатому, а не по out/ целиком',
      ],
    },
    parked: [
      { name: 'web-quality-skills/seo (Addy Osmani)', url: 'https://github.com/addyosmani/web-quality-skills',
        take: 'references/STRUCTURED-DATA.md — сверочный лист для lib/ld.ts в день включения offers; чеклист аудита — прочитать один раз. Измеримая половина уже в check:seo.' },
      { name: 'claude-seo (AgriciDaniel)', url: 'https://github.com/AgriciDaniel/claude-seo',
        take: 'ставится у заказчика, не в проект (8 МБ, Python, Playwright): по проду прогнать /seo audit, /seo schema, /seo hreflang, /seo technical. Правила hreflang и разметки уже в check:seo.' },
      { name: 'web-quality-skills/core-web-vitals + performance', url: 'https://github.com/addyosmani/web-quality-skills',
        take: 'отправные числа бюджета веса (страница 1.5 МБ, скрипты 300 КБ, стили 100 КБ) — для check:weight, который ещё не заведён. Серверная половина не про статический экспорт.' },
      { name: 'web-quality-skills/accessibility (WCAG.md)', url: 'https://github.com/addyosmani/web-quality-skills',
        take: 'прочитать один раз перед сдачей как список; меряется уже семьями check:craft.' },
      { name: 'web-quality-skills/best-practices (SECURITY.md)', url: 'https://github.com/addyosmani/web-quality-skills',
        take: 'заголовки безопасности (CSP, HSTS, X-Content-Type-Options) — это конфиг нгинкса в deploy/, не разметка; сверить один раз перед сдачей. Остальное (doctype, кодировка, viewport, aspect-ratio снимков) уже в check:seo и check:craft.' },
    ],
  },
  {
    n: 6, name: 'Жизнь',
    builds: 'сайт показан людям: Search Console, замер после каждого выката, слежение за тем, что разметка и адреса не уехали, новые тексты по спросу.',
    skills: ['stages', 'craft', 'code'],
    checks: ['typecheck', 'check:css', 'check:code', 'check:lint', 'test', 'check:open', 'build:site', 'check:urls', 'check:seo', 'check:stage'],
    gate: {
      machine: [],
      human: [
        'Search Console подключена, карта сайта отправлена, ошибок обхода нет',
        'после каждого выката: адреса и разметка не уехали — это CI (check:urls, check:seo), а не память',
        'у сайта одна витрина и один домен: образцов на нём не осталось нигде',
      ],
    },
    parked: [
      { name: 'seo-google (claude-seo) — Search Console, PageSpeed, CrUX', url: 'https://github.com/AgriciDaniel/claude-seo',
        take: 'нужны учётки заказчика; отчёт по настоящим данным раз в месяц.' },
      { name: 'seo-drift (claude-seo)', url: 'https://github.com/AgriciDaniel/claude-seo',
        take: 'идея «слепок до/после выката» — у нас это делают check:urls и check:seo в CI. Не ставить, а помнить, что уже есть.' },
    ],
  },
]

/**
 * Спит, пока в проекте нет механики. Это не этап, а предикат по конфигу:
 * скилл платформы ставится в день, когда описанное в нём заработало, и ни
 * днём раньше (правило craft: «скилл платформы ставится в день, когда
 * механика появилась»). `npm run stage` печатает такие отдельно и громко
 * говорит, когда предикат стал истинным.
 */
export const PLATFORM = [
  {
    name: 'next-cache-components · next-cache-components-optimizer (vercel/next.js)',
    url: 'https://github.com/vercel/next.js',
    sleeps: 'пока в next.config.ts стоит output: "export" — сервера нет, кэшировать и навигацию ускорять нечего',
    awake: () => has('next.config.ts') && !/output:\s*['"]export['"]/.test(src('next.config.ts')),
    take: 'в день, когда экспорт уйдёт (данные в момент запроса: остатки, корзина, заказы) — включить cacheComponents их первым скиллом и пройти вторым по маршрутам, которые он назовёт заблокированными.',
  },
  {
    name: 'test-driven-development (Superpowers)',
    url: '.claude/skills/test-driven-development/',
    sleeps: 'пока в package.json нет `test` — красный тест перед кодом писать нечем',
    awake: () => script('test'),
    take: 'с этого дня правка поведения начинается с падающего теста; скилл лежит рядом и применяется как написан.',
  },
  {
    name: 'скиллы источника данных (Payload, Vendure) и платёжного шлюза',
    url: 'README.md — раздел «Стекът»',
    sleeps: 'пока каталог — массив в lib/products.ts',
    awake: () => /payload|vendure|@medusajs|shopify/i.test(src('package.json')),
    take: 'lib/products.ts сохраняет форму: меняется тело, с литерала на запрос. Скилл берётся за тем, как ходить за данными, а не за тем, как их показывать.',
  },
]

/** Скиллы, которые работают на любом этапе: процесс, а не предмет. */
export const ALWAYS = [
  'stages', 'craft (при любой правке CSS)', 'code (при любой правке TypeScript)',
  'Superpowers: brainstorming · writing-plans · systematic-debugging · verification-before-completion · finishing-a-development-branch',
]

/* ── текущий этап ──────────────────────────────────────────────────────── */

/** Строка в CLAUDE.md: `Этап производства: **2 · Вёрстка**`. Одно место,
 *  и его читают двое — модель в начале сессии и этот файл. */
export const STAGE_LINE = /Этап производства:\s*\**\s*(\d)/

export function currentStage() {
  const m = src('CLAUDE.md').match(STAGE_LINE)
  if (!m) return null
  return STAGES.find((s) => s.n === Number(m[1])) ?? null
}

/** Ворота этапа: список того, что не держится. Пустой список — ворота
 *  держатся. */
export function gateProblems(stage) {
  const out = []
  for (const test of stage.gate.machine) {
    let r
    try { r = test() } catch (e) { r = `предикат упал: ${e.message}` }
    if (r) out.push(r)
  }
  return out
}
