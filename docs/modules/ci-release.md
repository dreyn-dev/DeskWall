# Модуль: CI и релизы

- **Статус:** работает, сборки не подписаны
- **Код:** `.github/workflows/ci.yml`, `turbo.json`, `biome.json`
- **Обновлено:** 2026-11-20

## Назначение

Проверяет каждый PR и пуш в `main`, собирает установщик Windows и публикует ночную сборку.

## Устройство

- Задача `web` (ubuntu): `pnpm lint`, `typecheck`, `test`, `build`, Playwright e2e.
- Задача `windows`: `cargo fmt --check`, `clippy -D warnings`, `cargo test`, `pnpm tauri build
  --bundles nsis`, артефакт `DeskWall-windows-x64`.
- Пуш в `main`: пересоздаёт pre-release [`nightly`](https://github.com/dreyn-dev/DeskWall/releases/tag/nightly)
  с установщиком (скачивается без логина).
- `release.yml`: по тегу `vX.Y.Z` собирает подписанный установщик и публикует его с `latest.json`
  в публичный репозиторий выпусков ([updater.md](updater.md), [process.md](process.md)).
- Установщик NSIS ставится для текущего пользователя, без прав администратора.

## Что сделано

- CI и неподписанная сборка (PR #1), публикация `nightly` (PR #2).
- 2026-11-20: `pnpm knip` в задаче `web` (неиспользуемые файлы, экспорты и зависимости; настройка
  `knip.jsonc`, страницы тем из `public/` указаны как точки входа). `audit.yml`: `cargo audit` по
  базе RustSec при изменении `Cargo.lock`, по понедельникам и кнопкой. `.github/dependabot.yml`:
  раз в неделю PR с обновлениями npm и Cargo (минорные и патчи группой), раз в месяц GitHub Actions.
  Первый `cargo audit`: 6 уязвимостей в `zip` 4.6.1 (через `tauri-plugin-updater`); у плагина
  отключена функция `zip` (на Windows обновление ставит NSIS .exe напрямую), теперь только
  предупреждения о заброшенных Linux-зависимостях Tauri (gtk/glib, zbus), на Windows не попадают.

## Открытые задачи

- [ ] Подпись кода (Azure Artifact Signing).
- [ ] Версионирование и релизы (Changesets).
- [ ] winget-манифест.
- [ ] Скриншот-тесты тем.

## Известные проблемы и ограничения

- На раннерах GitHub WebGL рисуется программно, несколько кадров в секунду. Поэтому у e2e
  таймаут ожиданий 20 с (`playwright.config.ts`, PR #3).

## Как проверить

Вкладка Actions репозитория; локально команды из `AGENTS.md`.
