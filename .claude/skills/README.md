# Вендоренные дизайн-скиллы

Лежат здесь, а не подключены маркетплейсом, потому что маркетплейсы в этих
сессиях не скачиваются: `~/.claude/plugins/installed_plugins.json` остаётся
пустым, и объявленные в `.claude/settings.json` плагины не появляются. Из
репозитория скиллы грузятся всегда.

| Источник | Лицензия | Что взято |
| --- | --- | --- |
| [leonxlnx/taste-skill](https://github.com/leonxlnx/taste-skill) | MIT | `taste-skill`, `minimalist-skill`, `redesign-skill`, `brandkit`, `brutalist-skill`, `soft-skill`, `output-skill` |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache 2.0 | `impeccable` — `SKILL.md` и `reference/` |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | MIT | `emil-design-eng`, `improve-animations` |

Тексты скиллов не менялись. Лицензии рядом: `LICENSE.taste-skill`,
`LICENSE.impeccable`, `LICENSE.emil-kowalski`.

Скиллы Ковальского поставлены потому, что таблица маршрутизации в `craft`
называла их по имени, а файлов в проекте не было: указатель в никуда. Взяты
ровно те два, которые там названы, — про вкус и ощущение (`emil-design-eng`)
и про аудит движения (`improve-animations`). Остальные девять из того
репозитория — про Swift, Expo и выбор библиотеки компонентов — здесь не
нужны и не взяты.

## Чего сознательно нет

- **`impeccable/scripts/`** (1,7 МБ). Это launcher, который при первом запуске
  тянет свой бинарь, плюс 500-килобайтный live-browser. Сам `SKILL.md`
  описывает, как работать, если launcher отсутствует, — значит шаг загрузки
  контекста просто пропускается, а ценность скилла (`reference/*.md`:
  craft-floor, critique, layout, typeset, colorize) остаётся.
- **`imagegen-*`, `stitch-skill`, `image-to-code-skill`** из taste-skill —
  им нужен генератор изображений, а в этой сессии его нет.
- **`brandkit`** взят, хотя он тоже про генерацию картинок: его метод
  (аргумент бренда → метафора → редукция) применяется руками, по нему сделан
  второй заход логотипа.

## Обновление

```
git clone --depth 1 https://github.com/leonxlnx/taste-skill.git /tmp/ts
cp -r /tmp/ts/skills/<имя> .claude/skills/

git clone --depth 1 https://github.com/emilkowalski/skills.git /tmp/em
cp -r /tmp/em/skills/<имя> .claude/skills/
```
