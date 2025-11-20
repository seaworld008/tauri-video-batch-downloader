use std::env;

use video_downloader_pro::commands::import::preview_import_data;
use video_downloader_pro::core::models::ImportPreview;

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: preview_cli <file-path> [max-rows]");
        std::process::exit(1);
    }

    let file_path = args[1].clone();
    let max_rows = args
        .get(2)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(10);

    match preview_import_data(file_path, Some(max_rows)).await {
        Ok(preview) => print_preview(preview),
        Err(error) => {
            eprintln!("Error: {error}");
            std::process::exit(1);
        }
    }
}

fn print_preview(preview: ImportPreview) {
    println!("Headers: {:?}", preview.headers);
    println!("Total rows: {}", preview.total_rows);
    println!("Encoding: {}", preview.encoding);
    println!("Field mapping: {:?}", preview.field_mapping);
    println!("Preview rows:");

    for row in preview.rows {
        println!("  {:?}", row);
    }
}
