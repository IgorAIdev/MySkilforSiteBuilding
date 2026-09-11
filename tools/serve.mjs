/**
 * Статический сервер для проверок — тот же, что нгинкс на проде.
 *
 * Заведён по счёту. Отрисованная проверка меряет ТО, ЧТО ПОДАНО, и подать
 * легко не то: `python3 -m http.server` отдавал листинг каталога вместо
 * страницы, и три страницы из пяти не мерились вовсе, а проверка при этом
 * рапортовала числа и была зелёной. `serve` уводит `/bg` на `/bg/` и ищет
 * там `index.html`, которого у статического экспорта нет: с языковыми
 * адресами это стало ломать уже все страницы разом. `serve -s` (режим
 * одностраничного приложения) переписывает любой адрес на `index.html`, и
 * находка приходит с чужим адресом.
 *
 * Поэтому сервер здесь свой и повторяет `deploy/nginx.conf`: `try_files $uri
 * $uri.html $uri/`, корень уводит на язык магазина, промах без языка — на
 * болгарскую версию того же пути. Разойтись им нельзя: проверка, меряющая не
 * то, что отдаёт прод, хуже отсутствующей.
 *
 *   node tools/serve.mjs [порт] [папка]
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const PORT = Number(process.argv[2] ?? 8099)
const ROOT = join(new URL('..', import.meta.url).pathname, process.argv[3] ?? 'out')
const DEFAULT_LANG = 'bg'

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
}

const file = async (path) => {
  try { return (await stat(path)).isFile() ? path : null } catch { return null }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const uri = normalize(decodeURIComponent(url.pathname)).replace(/\/+$/, '') || '/'

  if (uri === '/') {
    res.writeHead(302, { Location: `/${DEFAULT_LANG}` })
    return res.end()
  }

  /* Прежний одиночный адрес товара. Файла у него больше нет — у каждого
     товара свой адрес, — и нгинкс уводит его на полку масел. Повторяется
     здесь потому, что расходиться серверу проверки с продом нельзя: проверка,
     меряющая не то, что отдаёт прод, хуже отсутствующей. */
  const wasProduct = /^\/(bg|en)\/product$/.exec(uri)
  if (wasProduct) {
    res.writeHead(301, { Location: `/${wasProduct[1]}/catalog/oils` })
    return res.end()
  }

  const hit = await file(join(ROOT, uri))
    ?? await file(join(ROOT, `${uri}.html`))
    ?? await file(join(ROOT, uri, 'index.html'))

  if (!hit) {
    /* Промах без языка уходит на язык магазина; промах ВНУТРИ языка — 404,
       иначе /bg/чего-нет крутилось бы в /bg/bg/чего-нет без конца. */
    if (!/^\/(bg|en)(\/|$)/.test(uri) && !uri.startsWith('/_next')) {
      res.writeHead(302, { Location: `/${DEFAULT_LANG}${uri}` })
      return res.end()
    }
    const page = await file(join(ROOT, `/${DEFAULT_LANG}/404.html`)) ?? await file(join(ROOT, '404.html'))
    res.writeHead(404, { 'Content-Type': TYPES['.html'] })
    return res.end(page ? await readFile(page) : 'not found')
  }

  res.writeHead(200, { 'Content-Type': TYPES[extname(hit)] ?? 'application/octet-stream' })
  res.end(await readFile(hit))
}).listen(PORT, () => console.log(`· сайт из out/ на http://localhost:${PORT} — как отдаёт нгинкс`))
