# 0002. Стек

- Дата: 2026-11-13
- Статус: принято
- Кто решил: Mark (по плану MVP)

## Контекст

У референса хост на C# / .NET Framework + WebView2 и монолитные HTML-темы на WebGL2 без сборки,
типов и тестов. Mark просит лучшие и новейшие практики.

## Решение

| Слой | Выбор |
| --- | --- |
| Хост | Rust (edition 2024) + Tauri 2, crate `windows` для Win32/COM |
| Сцена | three.js `WebGPURenderer` + шейдеры только на TSL (WebGPU и запасной WebGL2 из одного кода) |
| UI настроек | React 19 + Vite + Tailwind CSS 4 |
| Репозиторий | pnpm workspaces + Turborepo |
| Качество | Biome, Vitest, Playwright, clippy, cargo test |
| CI | GitHub Actions (ubuntu для веба, windows для хоста и установщика NSIS) |
| Позже | Azure Artifact Signing, Tauri updater, Sentry по согласию, Astro-лендинг |

## Альтернативы

Electron (тяжелее, сотни МБ), оставить C# (устаревший .NET Framework, нет пути на macOS).

## Последствия

- Отклонения от плана в прототипе: протокол пока описан вручную в TS и Rust с тестами формы
  вместо генерации `tauri-specta`; i18n простым словарём вместо Lingui. Пересмотреть, когда
  протокол и число строк вырастут.
- Классические темы (Пляж, Луг) остаются на чистом WebGL2 внутри iframe, см. ADR-0004.
