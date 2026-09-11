/**
 * Что сейчас нужно — по этапу производства сайта.
 *
 * Заведён по слову заказчика: «скилл про поиск сейчас не нужен, а к финалу
 * понадобится — и я его забуду». Забудет не он, а сессия: у неё нет вчера.
 * Единственное, что переживает конец сессии, — файл, который читается
 * раньше кода, и проверка, которая валит сборку. Этот файл — оба сразу.
 *
 *   node tools/stage.mjs           брифинг: что строится, кто работает,
 *                                  что прогнать перед сдачей, что ждёт
 *   node tools/stage.mjs --gate    ворота: всё, что уже пройдено,
 *                                  держится (в CI как check:stage)
 *   node tools/stage.mjs --all     вся карта этапов
 *
 * Текущий этап — одна строка в CLAUDE.md: `Этап производства: **2 · Вёрстка**`.
 * Перевести стрелку — это правка строки, и она делается после разговора с
 * заказчиком: переход этапа меняет, что включено на витрине.
 *
 * Ворота — храповик по этапам. Проверка не требует, чтобы ТЕКУЩИЙ этап был
 * закончен, — он потому и текущий. Она требует, чтобы ПРОЙДЕННЫЕ не
 * разъехались: шкала, заведённая на нулевом, не может исчезнуть на третьем,
 * а флаг настоящести, включённый на четвёртом, — выключиться на шестом.
 */

import { relative } from 'node:path'
import { STAGES, ALWAYS, PLATFORM, currentStage, gateProblems, ROOT } from './stages.mjs'

const arg = (f) => process.argv.includes(f)

const title = (s) => `${s.n} · ${s.name}`
const line = (ch, text) => console.log(`  ${ch} ${text}`)

function brief(stage, { full = false } = {}) {
  console.log(`\n${title(stage)}${full ? '' : `   (строка «Этап производства:» в CLAUDE.md)`}`)
  console.log(`  Что строится: ${stage.builds}`)
  console.log(`  Кто работает: ${stage.skills.join(', ')}`)
  console.log(`  Перед сдачей, в этом порядке: ${stage.checks.map((c) => `npm run ${c}`).join(' · ')}`)

  const problems = gateProblems(stage)
  const next = STAGES.find((s) => s.n === stage.n + 1)
  console.log(`\n  Ворота${next ? ` (чтобы перейти к ${title(next)})` : ''}:`)
  for (const p of problems) line('✗', p)
  if (!problems.length && stage.gate.machine.length) line('✓', 'всё, что меряется, держится')
  for (const h of stage.gate.human) line('□', `${h}   (глазом)`)

  if (stage.parked.length) {
    console.log('\n  Просыпается на этом этапе:')
    for (const p of stage.parked) {
      line('·', `${p.name} — ${p.url}`)
      console.log(`      ${p.take}`)
    }
  }
}

/* ── вся карта ─────────────────────────────────────────────────────────── */
if (arg('--all')) {
  console.log('Этапы производства сайта — порядок ВОРОТ, а не работ.')
  for (const s of STAGES) brief(s, { full: true })
  console.log('\nВсегда, на любом этапе:')
  for (const a of ALWAYS) line('·', a)
  console.log('\nСпит, ждёт механики (не этапа):')
  for (const p of PLATFORM) {
    line(p.awake() ? '⚠' : '·', `${p.name}${p.awake() ? ' — ПРОСНУЛСЯ' : ''}`)
    console.log(`      ${p.sleeps}`)
    console.log(`      ${p.take}`)
  }
  process.exit(0)
}

/* ── текущий этап ──────────────────────────────────────────────────────── */
const stage = currentStage()
if (!stage) {
  console.error('\n✗ В CLAUDE.md нет строки этапа. Добавьте одну — например:')
  console.error('    Этап производства: **0 · Основание**')
  console.error(`  Этапы: ${STAGES.map(title).join(' · ')}`)
  console.error('  Это одно место, где записано, где проект находится; его читают')
  console.error('  и модель в начале сессии, и эта проверка.')
  process.exit(1)
}

/* ── ворота: пройденное держится ───────────────────────────────────────── */
if (arg('--gate')) {
  let failed = false
  for (const s of STAGES.filter((s) => s.n < stage.n)) {
    const problems = gateProblems(s)
    if (problems.length) {
      failed = true
      console.error(`\n✗ ${title(s)} — пройденные ворота не держатся:`)
      for (const p of problems) console.error(`    ${p}`)
    } else {
      console.log(`✓ ${title(s)} держится`)
    }
  }
  const now = gateProblems(stage)
  console.log(`· ${title(stage)} — текущий; до перехода: ${now.length ? now.length + ' пункт(а) машиной' : 'машиной всё'}${stage.gate.human.length ? ` + ${stage.gate.human.length} глазом` : ''}`)
  for (const p of PLATFORM) if (p.awake()) {
    console.log(`⚠ проснулся скилл платформы: ${p.name}\n    ${p.take}`)
  }
  if (failed) {
    console.error('\nЭтап нельзя считать пройденным, если его ворота перестали держаться.')
    console.error(`Либо чините, либо — если это осознанное решение — верните строку этапа в ${relative(ROOT, 'CLAUDE.md') || 'CLAUDE.md'} назад.`)
    process.exit(1)
  }
  process.exit(0)
}

/* ── брифинг ───────────────────────────────────────────────────────────── */
brief(stage)

const passed = STAGES.filter((s) => s.n < stage.n)
if (passed.length) {
  const broken = passed.filter((s) => gateProblems(s).length)
  console.log(`\n  Пройдено: ${passed.map((s) => `${title(s)} ${gateProblems(s).length ? '✗' : '✓'}`).join(', ')}`)
  if (broken.length) console.log('  ✗ пройденные ворота не держатся — npm run check:stage покажет, что именно')
}

const later = STAGES.filter((s) => s.n > stage.n && s.parked.length)
if (later.length) {
  console.log('\n  Ждёт своего дня (не ставится, пока не настал):')
  for (const s of later) for (const p of s.parked) line('·', `${title(s)} — ${p.name}`)
}

console.log('\n  Спит, ждёт механики:')
for (const p of PLATFORM) line(p.awake() ? '⚠' : '·', `${p.name}${p.awake() ? ' — ПРОСНУЛСЯ: ' + p.take : ' — ' + p.sleeps}`)

console.log('\n  Всегда: ' + ALWAYS.join('; '))
console.log('\n  Вся карта: npm run stage -- --all')
