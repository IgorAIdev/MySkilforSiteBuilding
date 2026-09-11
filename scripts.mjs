/**
 * Команды набора — один список на всех.
 *
 * Заведено по счёту: список жил в двух местах — в сборщике (`tools/kit.mjs`)
 * и в ставщике (`tools/kit/install.mjs`), — и они разошлись ровно так, как
 * расходятся две копии. Одна сессия дописала в набор линтер и тесты, другая
 * — проверку разметки и этапы; каждая правила свою копию. После слияния
 * ставщик раскладывал в новый проект файлы линтера, но команды `check:lint`
 * не заводил: проверка приезжала и не запускалась никем.
 *
 * Это тот самый признак заплатки из правил проекта: на вопрос «где это
 * решается?» ответов стало два. Теперь один.
 *
 * В опубликованном наборе он лежит рядом с `install.mjs` и переезжает в
 * проект вместе с ним: `npm run kit` из проекта, где заготовок `tools/kit/`
 * нет, собирает набор заново — и берёт список отсюда.
 */

export const SCRIPTS = {
  images: 'node tools/shrink.mjs',
  typecheck: 'tsc --noEmit',
  'check:css': 'node tools/check-css.mjs',
  'check:code': 'node tools/check-code.mjs',
  'check:lint': 'node tools/check-lint.mjs',
  lint: 'oxlint app components lib',
  test: 'node tools/check-test.mjs',
  'check:craft': 'node tools/check-craft.mjs',
  'check:open': 'node tools/check-open.mjs',
  'check:urls': 'node tools/check-urls.mjs',
  'check:seo': 'node tools/check-seo.mjs',
  'check:stage': 'node tools/stage.mjs --gate',
  stage: 'node tools/stage.mjs',
  serve: 'node tools/serve.mjs',
  sweep: 'node tools/sweep.mjs',
  shade: 'node tools/shade.mjs',
  kit: 'node tools/kit.mjs',
}
