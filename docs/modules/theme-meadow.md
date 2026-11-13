# Модуль: Тема «Луг» (Meadow)

- **Статус:** перенесена из Deskland
- **Код:** `apps/desktop/public/themes/classic/meadow.{html,js}`, `meadow-boy.js`, `meadow-cat.js`,
  `assets/meadow-*.png`, `thumbs/meadow.webp`; параметры в `apps/desktop/src/shared/themes.ts`
- **Связанные решения:** ADR-0001, ADR-0004
- **Обновлено:** 2026-11-13

## Назначение

Луг с травой вокруг иконок, мальчик с воздушным змеем и чёрный котёнок.

## Устройство

Самостоятельная страница WebGL2 референса (исходник `prototype/meadow.html`) в iframe
[страницы обоев](wallpaper-page.md). Параметры: `sigma`, `cover`, `flow`, `showBoy`, `showCat`.
Перенос повторяется скриптом `tools/vendor_classic_themes.py`.

## Что сделано

- Перенос и параметры в настройках (PR #2).

## Открытые задачи

- [ ] Решить, остаётся ли тема в публичном релизе (ADR-0004).

## Как проверить

`pnpm e2e`; скриншот `docs/images/classic-meadow.webp`.
