use std::path::{Path, PathBuf};

use crate::core::ytdlp_support::{env_path, exe_name, sidecar_path};

pub use vdpro_providers::ffmpeg_muxer::{
    build_mux_av_args, build_remux_args, infer_ffmpeg_container, mux_av_streams,
    remux_single_stream, resolve_ffmpeg_binary_from_candidates,
};

pub async fn resolve_ffmpeg_binary(override_path: Option<&Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = override_path {
        candidates.push(path.to_path_buf());
    }
    if let Some(path) = env_path("VDP_FFMPEG_PATH") {
        candidates.push(path);
    }
    if let Some(path) = sidecar_path("ffmpeg") {
        candidates.push(path);
    }
    candidates.push(PathBuf::from(exe_name("ffmpeg")));

    resolve_ffmpeg_binary_from_candidates(&candidates).await
}
