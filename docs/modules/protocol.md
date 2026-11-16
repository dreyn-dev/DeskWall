# Модуль: Протокол хост ↔ страница

- **Статус:** стабильный для прототипа
- **Код:** `packages/protocol/src/index.ts`, `apps/desktop/src-tauri/src/protocol.rs`
- **Связанные решения:** ADR-0002
- **Обновлено:** 2026-11-16

## Назначение

Единственное место, где описаны сообщения между Rust и вебом и формат настроек. Обе стороны
держатся синхронно, у обеих есть тесты формы.

## Устройство

- События хоста: `deskwall://icons` (`IconsPayload`: `visible`, `surface`, `icons[]` в физических
  пикселях), `deskwall://pause` (`paused`, `reasons`: `user | fullscreen | locked | settings`), `deskwall://settings` (`Settings`).
- Команды: `wallpaper_ready(backend)` → `{ native }` (хост отвечает окну, которое позвало),
  `system_locales()` → `string[]`, `list_screens()` → `ScreenInfo[]` (`id`, `primary`, `x`, `y`,
  `w`, `h` в физических пикселях).
- `Settings`: тема (`year | beach | meadow | forest | thaw | isles`), параметры тем, палитра, `landReach`, `roughness`,
  `motion`, `fps` (15/30/60), `contours`, `pauseOnFullscreen`, `autostart`, `labelVeil` (0..1, тень под подписями иконок), `trayOpens` (`window | dock`, что открывает клик по значку трея), `hintSeen` (подсказка первого запуска показана), `locale` (`auto | en`;
  русский только через `auto`), `screenThemes` (для доп. мониторов по `id`: тема или `off`;
  нет записи — `same`, как на основном). `themeForScreen(settings, screen)` даёт тему окна.
  `DEFAULT_SETTINGS`: тема `beach`, 30 fps.
- `normalizeSettings`, `parseIconsPayload` и `parseScreens` проверяют любые входящие данные.
- Классические темы внутри iframe говорят на протоколе референса (`ready`, `icons` как
  `[l,t,r,b]`, `settings`, `pause`); перевод делает [wallpaper-page](wallpaper-page.md).

## Что сделано

- `ScreenInfo`, `screenThemes`, `themeForScreen`, команда `list_screens`, тесты формы в TS и
  Rust (ветка `feat/multi-monitor`, 2026-11-16).
- Типы и проверки (PR #1), id тем и параметры тем (PR #2).
- Причина паузы `settings` в TS и Rust, тест формы; настройки `trayOpens` (`window | dock`) и
  `hintSeen` (ветка `feat/settings-redesign`, 2026-11-14).

## Открытые задачи

- [ ] Генерировать TS-типы из Rust (`tauri-specta`), когда протокол вырастет.

## Как проверить

`pnpm test` (Vitest, `index.test.ts`) и `cargo test` (тесты формы в `protocol.rs`).
