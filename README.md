# DeskWall

**A living wallpaper for Windows that grows a landscape around your desktop icons.**

Scenery grows out of your icons, merges when icons sit close together and reshapes smoothly when
you move them: raked gravel and moss, glowing threads, ripples, contour lines, watercolour,
constellations, window frost. The rest of the screen stays calm. Everything runs locally: no
account, no AI service, no network.

> **Status: prototype (0.1).** Eight of DeskWall's own themes, the Windows host, tray and
> settings. Not signed yet and not ready for daily use. [Русская версия ниже](#по-русски).

## How it works

| Layer | Tech | Where |
| --- | --- | --- |
| Native host | Rust + Tauri 2 | `apps/desktop/src-tauri` |
| Desktop attach | Win32: parent the window under the icon layer (Progman on 24H2+, WorkerW before) | `src/desktop/windows.rs` |
| Icon positions | Shell API: `IShellWindows` → `IShellBrowser` → `IFolderView::GetItemPosition`. No reading of Explorer's memory | `src/desktop/windows.rs` |
| Full-screen pause | `SHQueryUserNotificationState` + foreground window checks | `src/desktop/windows.rs` |
| Scenes | Self-contained WebGL2 pages on a shared kit (icon field, morphing, sprites, instanced lines), hosted in an iframe | `apps/desktop/public/themes/classic` |
| Settings | React 19 + Tailwind CSS 4 | `apps/desktop/src/settings` |
| Host ↔ page messages | Typed events, mirrored in Rust | `packages/protocol`, `src-tauri/src/protocol.rs` |

The host polls the icon layout four times per second (only changes are sent). The page turns
the icon rectangles into a smooth height field (rounded-box SDFs blended with a smooth
minimum), uploads it as a small half-float texture and morphs between layouts over ~0.9 s.
Rendering is capped at 30 fps by default and pauses when a full-screen window covers the
wallpaper.

## Develop

Requirements: Node 22+, pnpm 10, Rust stable. Windows needs the WebView2 runtime (preinstalled
on Windows 11) and the MSVC build tools.

```sh
pnpm install
pnpm --filter @deskwall/desktop dev   # browser preview: http://localhost:5180/wallpaper.html
pnpm tauri dev                        # full desktop app
pnpm tauri build --bundles nsis       # installer in apps/desktop/src-tauri/target/release/bundle
```

In the browser preview you can drag the sample icons around. `?hud` shows the active renderer
and frame count, `?renderer=webgl` forces the WebGL2 backend.

Checks: `pnpm lint` (Biome), `pnpm typecheck`, `pnpm test` (Vitest), `pnpm e2e` (Playwright),
`cargo clippy` / `cargo test` in `apps/desktop/src-tauri`. CI runs all of them and builds an
unsigned Windows installer. Every push to `main` publishes it as the
[`nightly` pre-release](https://github.com/dreyn-dev/DeskWall/releases/tag/nightly).

## Roadmap

Next up after the prototype: real icon sizes per view mode, multi-monitor, Explorer restart
handling via `TaskbarCreated`, code signing (Azure Artifact Signing) and the Tauri updater,
more themes and the final visual identity.

## Project docs

Plan, status, decisions and one page per module live in [`docs/`](docs/README.md) (in Russian).

## License

GPL-3.0-only, see [LICENSE](LICENSE). The name and icon are covered by
[TRADEMARKS.md](TRADEMARKS.md). DeskWall is inspired by
[Deskland](https://github.com/BLEZZ0102/Deskland); see [NOTICE](NOTICE).

---

## По-русски

DeskWall — живые обои для Windows: вокруг иконок на рабочем столе вырастает пейзаж. Соседние
иконки дают одну общую картину, и она плавно меняет форму, когда иконки двигают. Всё работает локально, без аккаунта и без сети.

Это прототип: восемь своих тем DeskWall, хост для Windows, трей и окно настроек. Сборка не
подписана. Хост написан на Rust + Tauri 2, позиции иконок берутся через официальный Shell API
(`IFolderView`), темы на WebGL2 с общей основой `kit.js`, настройки
на React 19 + Tailwind 4. Команды для разработки — в разделе «Develop» выше.
