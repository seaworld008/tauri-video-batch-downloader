Place packaged sidecar binaries here before running `pnpm tauri build`.

Expected names follow Tauri v2 `bundle.externalBin` target triples:

- `yt-dlp-$TARGET_TRIPLE`
- `ffmpeg-$TARGET_TRIPLE`
- `deno-$TARGET_TRIPLE`
- Windows builds add `.exe`, for example `yt-dlp-x86_64-pc-windows-msvc.exe`.

Development runs may use `VDP_YTDLP_PATH`, `VDP_FFMPEG_PATH`, `VDP_DENO_PATH`,
or PATH fallback.
