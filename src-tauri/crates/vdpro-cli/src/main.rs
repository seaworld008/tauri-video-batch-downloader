#[tokio::main]
async fn main() {
    let code = video_downloader_pro::cli::run_from_env().await;
    std::process::exit(code);
}
