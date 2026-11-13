# Модуль: Протокол хост ↔ страница

- **Статус:** стабильный для прототипа
- **Код:** `packages/protocol/src/index.ts`, `apps/desktop/src-tauri/src/protocol.rs`
- **Связанные решения:** ADR-0002
- **Обновлено:** 2026-11-13

## Назначение

Единственное место, где описаны сообщения между Rust и вебом и формат настроек. Обе стороны
держатся синхронно, у обеих есть тесты формы.

## Устройство

- События хоста: `deskwall://icons` (`IconsPayload`: `visible`, `surface`, `icons[]` в физических
  пикселях), `deskwall://pause` (`paused`, `reasons`), `deskwall://settings` (`Settings`).
- Команды: `wallpaper_ready(backend)` → `{ native }`, `system_locales()` → `string[]`.
- `Settings`: тема (`year | beach | meadow | forest | thaw | isles`), параметры тем, палитра, `landReach`, `roughness`,
  `motion`, `fps` (15/30/60), `contours`, `pauseOnFullscreen`, `autostart`, `labelVeil` (0..1, тень под подписями иконок), `locale` (`auto | en`;
  русский только через `auto`).
  `DEFAULT_SETTINGS`: тема `beach`, 30 fps.
- `normalizeSettings` и `parseIconsPayload` проверяют любые входящие данные.
- Классические темы внутри iframe говорят на протоколе референса (`ready`, `icons` как
  `[l,t,r,b]`, `settings`, `pause`); перевод делает [wallpaper-page](wallpaper-page.md).

## Что сделано

- Типы и проверки (PR #1), id тем и параметры тем (PR #2).

## Открытые задачи

- [ ] Генерировать TS-типы из Rust (`tauri-specta`), когда протокол вырастет.

## Как проверить

`pnpm test` (Vitest, `index.test.ts`) и `cargo test` (тесты формы в `protocol.rs`).
