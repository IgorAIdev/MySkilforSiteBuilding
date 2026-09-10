/**
 * Варианты снимков по ширинам — то, чего нет у статического экспорта.
 *
 * `next/image` умеет отдавать картинку по размеру места, но только когда за
 * ней стоит сервер. У нас `output: 'export'`, сервера нет, и в вёрстку уходит
 * обычный `<img src>`: один файл на все ширины. Замерено на собранном сайте —
 * снимок 1100px ложится в кадр 358px на телефоне. Втрое больше пикселей, то
 * есть примерно вдевятеро больше байтов, и 2.58 МБ до первой прокрутки.
 *
 * Поэтому варианты режутся заранее, на сборке. Оригиналы не трогаются: рядом
 * появляется `public/_r/<путь>-<ширина>.<расш>`, а `lib/shots.ts` — список
 * того, что нарезалось. Компонент `Shot` читает список и собирает `srcset`;
 * ширины, которой нет (снимок сам мельче), в наборе не будет, и браузер
 * никогда не попросит файл, которого нет.
 *
 * Список лежит в репозитории, а сами файлы — нет: список нужен типам и
 * сборке, файлы пересоздаются за секунды и весят мегабайты.
 *
 * Если sharp не поднялся — не падаем. Пустой список означает «вариантов нет»,
 * `Shot` отдаст оригинал, и сайт соберётся ровно как раньше. Проверка ремесла
 * при этом закричит про вес, и это правильный порядок: не собралось тише, а
 * собралось и пожаловалось.
 *
 *   node tools/shrink.mjs
 */

import { readdirSync, statSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, extname, relative, dirname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const PUB = join(ROOT, 'public')
const OUT = join(PUB, '_r')
const LIST = join(ROOT, 'lib', 'shots.ts')

/** Ширины, на которые режем. Верхняя — вдвое от самого широкого места на
 *  странице (кадр героя ~700px), чтобы экран с удвоенной плотностью получал
 *  честный файл, а не растянутый. */
const WIDTHS = [400, 700, 1000, 1400]
const EXT = new Set(['.jpg', '.jpeg', '.png'])

const walk = (dir) => {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '_r') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (EXT.has(extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}

let sharp = null
try {
  ;({ default: sharp } = await import('sharp'))
} catch {
  console.warn('shrink: sharp не поднялся — варианты не нарезаны, идём на оригиналах')
}

const files = existsSync(PUB) ? walk(PUB) : []
const made = {}
let cut = 0, kept = 0

for (const file of files) {
  const rel = '/' + relative(PUB, file).split('\\').join('/')
  if (!sharp) { made[rel] = []; continue }
  const src = sharp(file)
  const { width } = await src.metadata()
  const ext = extname(file).toLowerCase()
  const widths = WIDTHS.filter((w) => w < width)
  const have = []
  for (const w of widths) {
    const dest = join(OUT, relative(PUB, file)).replace(new RegExp(`${ext}$`), `-${w}${ext}`)
    have.push(w)
    if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(file).mtimeMs) { kept++; continue }
    mkdirSync(dirname(dest), { recursive: true })
    await sharp(file)
      .resize({ width: w, withoutEnlargement: true })
      .toFormat(ext === '.png' ? 'png' : 'jpeg', { quality: 78, mozjpeg: true })
      .toFile(dest)
    cut++
  }
  /* Своя ширина тоже в наборе — иначе на широком экране браузер выберет
     самый большой вариант вместо оригинала и картинка станет мягче. */
  made[rel] = [...have, width]
}

const body = `/* Создан \`tools/shrink.mjs\`. Руками не править: пересоздаётся на каждой сборке.
 *
 * Ключ — адрес оригинала, значение — ширины, которые для него нарезаны, плюс
 * его собственная. \`Shot\` собирает из этого \`srcset\`; чего здесь нет, того
 * браузер не попросит. */

export const SHOTS: Record<string, number[]> = ${JSON.stringify(made, null, 2)}
`
writeFileSync(LIST, body)
console.log(`shrink: снимков ${files.length}, нарезано ${cut}, уже было ${kept}`)
