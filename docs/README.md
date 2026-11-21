# База знаний DeskWall

Единая точка входа в проект. Любая новая сессия (человек или Claude) начинает отсюда, а не с
пересказа в чате. Правила ведения базы: [process.md](process.md).

## Что мы делаем

DeskWall: живые обои для Windows, где пейзаж вырастает вокруг иконок рабочего стола и плавно
перестраивается, когда иконки двигают. Самостоятельный продукт по мотивам
[Deskland](https://deskland.app/) (его открытый код: [BLEZZ0102/Deskland](https://github.com/BLEZZ0102/Deskland),
GPL-3.0). Своё имя, иконка и стиль; код открыт под GPL-3.0.

Владелец: Mark (GitHub `MarkKibkalo`, аккаунт репозитория `dreyn-dev`). Общение по-русски.

## Где что лежит

| Файл | Что в нём |
| --- | --- |
| [process.md](process.md) | Как работаем: начало и конец задачи, PR, мерж, что обновлять |
| [quality.md](quality.md) | Качество тем: почему проигрывали референсу, правила и чек-лист |
| [roadmap.md](roadmap.md) | Этапы до беты, объём MVP, статус каждого этапа |
| [log.md](log.md) | Журнал итогов: что сделано, когда, ссылки на PR |
| [decisions/](decisions/README.md) | Принятые решения (ADR): одно решение = один файл |
| [modules/](modules/README.md) | Модули: один модуль = один файл (назначение, файлы, статус, задачи) |
| [images/](images/) | Скриншоты для README и документации |

## Модули

| Модуль | Где в коде | Статус |
| --- | --- | --- |
| [Хост (Tauri)](modules/host.md) | `apps/desktop/src-tauri/src/{lib,state,tray}.rs` | прототип работает |
| [Рабочий стол Windows](modules/desktop-windows.md) | `apps/desktop/src-tauri/src/desktop/` | прототип работает на Win11 24H2 |
| [Протокол хост ↔ страница](modules/protocol.md) | `packages/protocol`, `src-tauri/src/protocol.rs` | стабильный |
| [Движок сцены](modules/engine.md) | `packages/engine` | темами не используется с 2026-11-20 |
| [Страница обоев](modules/wallpaper-page.md) | `apps/desktop/src/wallpaper`, `wallpaper.html` | прототип |
| [Основа классических тем](modules/theme-kit.md) | `apps/desktop/public/themes/classic/kit.js` | своя, работает |
| [Курсор на обоях (пасхалки)](modules/pointer.md) | `src-tauri/src/desktop/windows.rs`, `kit.js`, темы | прототип |
| [Тема «Пляж»](modules/theme-beach.md) | удалена, в истории git | удалена 2026-11-20 (похожа на Deskland, ADR-0013) |
| [Тема «Луг»](modules/theme-meadow.md) | удалена, в истории git | удалена 2026-11-20 (похожа на Deskland, ADR-0013) |
| [Тема «Осенний лес»](modules/theme-forest.md) | удалена, в истории git | удалена 2026-11-14 (качество) |
| [Тема «Проталины»](modules/theme-thaw.md) | `apps/desktop/public/themes/classic/thaw*` | своя, прототип |
| [Тема «Сад камней»](modules/theme-zen.md) | `apps/desktop/public/themes/classic/zen*` | скрыта на доработку с 2026-11-20 (ADR-0014) |
| [Тема «Грибница»](modules/theme-mycelium.md) | `apps/desktop/public/themes/classic/mycelium*` | своя, принята Mark, выпущена в 0.1.5, основная с 2026-11-20 |
| [Тема «Круги на воде»](modules/theme-ripples.md) | `apps/desktop/public/themes/classic/ripples*` | своя, принята Mark, выпущена в 0.1.5 |
| [Тема «Изолинии»](modules/theme-isolines.md) | `apps/desktop/public/themes/classic/isolines*` | своя, прототип, ждёт проверки Mark (ветка `feat/isolines`) |
| [Тема «Акварель»](modules/theme-watercolor.md) | `apps/desktop/public/themes/classic/watercolor*` | своя, прототип, ждёт проверки Mark (ветка `feat/watercolor`) |
| [«Живой год»](modules/theme-year.md) | удалена, в истории git | удалена 2026-11-14 (качество) |
| [Тема «Острова»](modules/theme-isles.md) | удалена, в истории git | удалена 2026-11-20 (похожа на Deskland, ADR-0013) |
| [Тема «Созвездия»](modules/theme-stars.md) | `apps/desktop/public/themes/classic/stars*` | своя, принята Mark |
| [Тема «Иней»](modules/theme-frost.md) | `apps/desktop/public/themes/classic/frost*` | скрыта на доработку с 2026-11-20 (ADR-0014) |
| [Окно настроек](modules/settings-ui.md) | `apps/desktop/src/settings`, `src/shared` | прототип нового дизайна, режимы «Окно» и «На рабочем столе» |
| [Автообновление](modules/updater.md) | `src-tauri/src/updater.rs`, `.github/workflows/release.yml` | прототип, ждёт первого релиза |
| [CI и релизы](modules/ci-release.md) | `.github/workflows/ci.yml` | работает, сборки не подписаны |
| [Бренд](modules/brand.md) | `brand/`, `TRADEMARKS.md` | рабочий, финальный стиль на шаге 3 |

## Текущее состояние (обновлять после каждой работы)

- **Шаг 1** (анализ и план MVP): готов. [План MVP](https://claude.ai/artifact/K13uws9QPF3vg42HoQtuWV),
  задачи в [Notion](https://app.notion.com/p/219ee0bc82984b25bea84683bcb0a7ff).
- **Шаг 2** (прототип): готов. PR #1 (Tauri-хост, движок, настройки) и PR #2 (Пляж и Луг) в `main`.
  Сборка работает на ПК Mark (Win11 24H2, WebGPU, обои под иконками).
- **Шаг 3** (свой стиль в Figma, лендинг, ключевые экраны): не начат.
- **Свои темы:** все темы свои. Пляж, Луг и Острова удалены 2026-11-20 как похожие на Deskland
  (ADR-0013), вместо них «Созвездия» и «Иней» (приняты Mark, PR #19). «Тихие камни» и «Иней»
  скрыты на доработку (ADR-0014, код остался), основная тема «Светонить». Во всех темах пасхалки и реакция на курсор (ADR-0010).
- Подробности по этапам: [roadmap.md](roadmap.md). Последние события: [log.md](log.md).

## Ссылки

- Репозиторий: https://github.com/dreyn-dev/DeskWall
- Ночная сборка: https://github.com/dreyn-dev/DeskWall/releases/tag/nightly
- План MVP (Claude Docs): https://claude.ai/artifact/K13uws9QPF3vg42HoQtuWV
- Задачи (Notion): https://app.notion.com/p/219ee0bc82984b25bea84683bcb0a7ff
- Референс: https://deskland.app/, https://github.com/BLEZZ0102/Deskland
