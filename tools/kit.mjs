/**
 * Стартовый набор для следующего сайта.
 *
 * Собирает в указанную папку то, что переживает конец проекта: скилл,
 * проверки, шкалы, примитивы и переносимые правила. Именно собирает, а не
 * держит копию в репозитории — копия разошлась бы с оригиналом за месяц, и
 * следующий проект начался бы с устаревшего фундамента. Ровно та болезнь, от
 * которой весь набор и лечит.
 *
 *   node tools/kit.mjs ../new-site        собрать набор в папку
 *   node tools/kit.mjs                    собрать в ./kit (для проверки)
 *
 * Базы храповиков обнуляются: на новом проекте долга нет, и первое же
 * нарушение обязано валить сборку. Здесь их нельзя обнулять — здесь долг
 * настоящий и чинится своим темпом; там нечему копиться.
 */

import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = resolve(process.argv[2] ?? join(ROOT, 'kit'))

/** Что переезжает. Список короткий намеренно: всё, что тут есть, должно
 *  работать на пустом проекте с первого дня. */
const FILES = [
  '.claude/skills/craft/SKILL.md',
  'tools/kit.mjs',
  'tools/check-css.mjs',
  'tools/check-craft.mjs',
  'tools/sweep.mjs',
  'tools/shrink.mjs',
  'tools/shade.mjs',
  'styles/tokens.css',
  'styles/primitives.module.css',
  'docs/rules.md',
  'docs/start.md',
]

const put = (rel) => {
  const dest = join(OUT, rel)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(join(ROOT, rel), dest)
}

for (const f of FILES) put(f)

/* Правила и CI — не приложение к набору, а его суть.
 *
 * Всё остальное требует, чтобы кто-то ПОМНИЛ: запустить проверку, свериться
 * со шкалой, показать скриншотом. Человек забудет, а новая сессия агента и
 * не знала. Эти два файла — единственные, которые работают без памяти:
 * `CLAUDE.md` читается раньше кода каждой сессией, CI падает без чьего-либо
 * участия.
 *
 * Поэтому они едут отдельными именами: `CLAUDE.md` в корень проекта,
 * рабочий процесс — туда, где GitHub его найдёт. */
mkdirSync(join(OUT, '.github/workflows'), { recursive: true })
copyFileSync(join(ROOT, 'tools/kit/CLAUDE.md'), join(OUT, 'CLAUDE.md'))
copyFileSync(join(ROOT, 'tools/kit/workflows/check.yml'), join(OUT, '.github/workflows/check.yml'))

/* Базы — пустые. Ноль в каждой семье значит «новое не заводится», а это и
   есть весь смысл храповика на чистом проекте. */
writeFileSync(join(OUT, 'tools/css-baseline.json'),
  JSON.stringify({ fontPx: 0, spacingPx: 0, breakpoint: 0, ratioNoCap: 0, motion: 0 }, null, 2) + '\n')
writeFileSync(join(OUT, 'tools/craft-baseline.json'),
  JSON.stringify({ placeholder: 0, measure: 0, target: 0, contrast: 0, collision: 0,
                   weight: 0, jump: 0, name: 0, heads: 0 }, null, 2) + '\n')

writeFileSync(join(OUT, 'README.md'), `# Стартовый набор вёрстки

Собран \`tools/kit.mjs\` из cbdin.bg. Не правьте здесь — правьте там, где
собрано, и пересоберите: копия, которую правят отдельно, расходится с
оригиналом за месяц.

## Что внутри

| | |
|---|---|
| \`.claude/skills/craft/SKILL.md\` | скилл: семь запретов, три шкалы, пять примитивов, четырнадцать проверок |
| \`styles/tokens.css\` | шкала размеров, шкала ритма, роли цвета, резервы под полосы |
| \`styles/primitives.module.css\` | пять примитивов раскладки плюс общие контролы |
| \`tools/check-css.mjs\` | храповик по файлам: размер, ритм, брейкпоинт, пропорция, движение |
| \`tools/check-craft.mjs\` | храповик по отрисованной странице: девять семей, контраст и вес — по пикселям |
| \`tools/sweep.mjs\` | съёмка на 33 ширинах от 320 до 1600 |
| \`tools/shrink.mjs\` | варианты снимков по ширинам для статического экспорта |
| \`tools/shade.mjs\` | яркость снимка под подписью, снятая с экрана |
| \`docs/rules.md\` | переносимые правила, каждое с дефектом, из-за которого заведено |
| \`docs/start.md\` | в каком порядке начинать |

## Как улучшать сам набор

Источник — cbdin.bg. Там правила выявляются дефектами, там же чинятся
проверки, оттуда набор пересобирается:

\`\`\`
cd путь/к/cbdin.bg
node tools/kit.mjs путь/к/клону/этого/репозитория
cd путь/к/клону && git add -A && git commit -m "набор из cbdin.bg" && git push
\`\`\`

Обратный ход — обновить набор в проекте, который его уже поставил, — тем же
клонированием поверх: файлы набора самодостаточны и ничего проектного не
затирают, кроме себя самих. Базы храповиков при этом перезапишутся нулями,
поэтому их стоит откатить: \`git checkout tools/*-baseline.json\`.

**Порядок соблюдать обязательно: набор — источник, проект — потребитель.**
Правка, сделанная в проекте и не вернувшаяся в набор, — это вторая
расходящаяся копия, то есть ровно та болезнь, от которой набор и лечит.

## Как поставить на другой машине

Набор лежит внутри cbdin.bg, а cbdin.bg на GitHub — к одному диску ничего не
привязано. Из любой пустой папки:

\`\`\`
git clone --depth 1 https://github.com/IgorAIdev/CBDin.bg.git /tmp/kit-src
node /tmp/kit-src/tools/kit.mjs .
rm -rf /tmp/kit-src
\`\`\`

## Что уже включено

Скрипты дописаны в \`package.json\` сборщиком. Осталось одно:

\`\`\`
npm i -D sharp serve wait-on && npx playwright install chromium
\`\`\`

Проверкам по странице нужен поднятый сайт и сервер, умеющий **чистые
адреса** (\`/product\` → \`product.html\`). \`python3 -m http.server\` их не
умеет: он отдаёт листинг каталога, и проверка тогда мерит листинг и молча
зеленеет. Это уже стоило одного дня.

\`\`\`
npm run build && npx serve out -l 8099
\`\`\`

Пути к Playwright задаются через \`PLAYWRIGHT=\`, адрес сайта — через \`SITE=\`.

## Что работает без вашей памяти

Два файла, и в этом весь смысл набора.

**\`CLAUDE.md\`** читается раньше кода каждой сессией агента. Не надо помнить
правила и не надо их пересказывать.

**\`.github/workflows/check.yml\`** валит сборку сам. Проверка, которую надо
не забыть запустить, будет забыта; проверка, которая валит сборку, — нет.

## Первое, что надо сделать

Прочитать \`docs/start.md\`. Он про порядок: фундамент раньше правил,
храповики раньше долга. Написан на восьмидесятой правке, а нужен был на
первой.
`)

/* Скрипты дописываются в package.json проекта, если он там есть. Иначе
   печатаются, чтобы вставить руками: набор не должен молча ничего не
   сделать и выглядеть при этом успешным. */
const SCRIPTS = {
  images: 'node tools/shrink.mjs',
  typecheck: 'tsc --noEmit',
  'check:css': 'node tools/check-css.mjs',
  'check:craft': 'node tools/check-craft.mjs',
  sweep: 'node tools/sweep.mjs',
  shade: 'node tools/shade.mjs',
  kit: 'node tools/kit.mjs',
}
const pkgPath = join(OUT, 'package.json')
let wired = false
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.scripts = { ...SCRIPTS, ...pkg.scripts }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  wired = true
}

console.log(`Набор собран: ${FILES.length + 5} файлов в ${OUT}`)
console.log('  · CLAUDE.md — правила, читаются раньше кода каждой сессией')
console.log('  · .github/workflows/check.yml — проверки падают сами, без чьей-либо памяти')
console.log('  · базы храповиков обнулены — на новом проекте долга нет')
if (wired) {
  console.log('  · скрипты дописаны в package.json')
} else {
  console.log('\nВ папке нет package.json — допишите скрипты сами:')
  console.log(JSON.stringify({ scripts: SCRIPTS }, null, 2))
}
/* Если целевая папка — клон репозитория скилла, набор туда просто лёг, и
   остаётся его опубликовать. Печатаем ровно те команды, а не «дальше
   закоммитьте»: команда, которую надо вспомнить, не выполняется. */
if (existsSync(join(OUT, '.git'))) {
  console.log(`
Это клон репозитория. Опубликовать обновлённый набор:

    cd ${OUT}
    git add -A && git commit -m "набор из cbdin.bg" && git push`)
} else {
  console.log('\nДальше: npm i -D sharp && npx playwright install chromium')
}
