# DeskWall: notes for contributors and coding agents

- Monorepo: pnpm workspaces + Turborepo. `apps/desktop` (Tauri app: Rust host + web UI),
  `packages/engine` (three.js scene), `packages/protocol` (host ↔ page message types).
- Keep `packages/protocol/src/index.ts` and `apps/desktop/src-tauri/src/protocol.rs` in sync;
  both have shape tests.
- Icon positions come from the Shell API (`IFolderView`). Never read Explorer's memory.
- The wallpaper runs all day: default 30 fps, pause when covered, no per-frame allocations, keep
  heavy work (field computation) on icon changes only.
- Shaders are TSL only, so they run on WebGPU and the WebGL2 fallback alike.
- Before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`; in `src-tauri`:
  `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
  (from Linux/macOS add `--target x86_64-pc-windows-msvc` to clippy to check the Windows code).
- Headless Chromium can't screenshot WebGPU canvases; e2e uses `?renderer=webgl`.
- Don't commit build output (`dist/`, `src-tauri/target/`), personal data or credentials.
- License GPL-3.0-only. Use the DeskWall name and icon only for this project (TRADEMARKS.md).
