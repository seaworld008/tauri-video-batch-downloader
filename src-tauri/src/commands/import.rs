//! Import command handlers for CSV and Excel files
//!
//! This module provides commands for importing download tasks from various file formats,
//! including CSV and Excel files with automatic encoding detection and field mapping.
//!
//! Uses the advanced FileParser system for robust file parsing with multi-encoding support.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tracing::{debug, error, info, warn};

use crate::core::file_parser::{
    EncodingDetector, FieldMapping, FileParser, FileParserConfig, VideoRecord,
};
use crate::core::models::{
    AppError, AppResult, DownloaderType, EncodingDetection, ImportPreview, ImportedData,
    TaskStatus, VideoInfo, VideoTask,
};
use crate::utils::file_utils::sanitize_filename;
use crate::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Complete import result with statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    /// Successfully imported data
    pub imported_data: Vec<ImportedData>,
    /// Parse statistics
    pub statistics: ImportStatistics,
    /// Detected file format
    pub file_format: String,
    /// Detected encoding
    pub encoding: String,
}

/// Import statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportStatistics {
    /// Total rows in file
    pub total_rows: usize,
    /// Successfully parsed rows
    pub parsed_rows: usize,
    /// Skipped rows (due to errors)
    pub skipped_rows: usize,
    /// Parse time in milliseconds
    pub parse_time_ms: u64,
    /// File size in bytes
    pub file_size: u64,
}

/// Supported file format information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileFormatInfo {
    /// Format name
    pub name: String,
    /// File extensions
    pub extensions: Vec<String>,
    /// Format description
    pub description: String,
    /// Whether format supports multiple sheets/tabs
    pub supports_multiple_sheets: bool,
}

/// All supported formats and encodings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportedFormats {
    /// Available file formats
    pub formats: Vec<FileFormatInfo>,
    /// Available encodings
    pub encodings: Vec<String>,
}

/// Import tasks from any supported file format (CSV/Excel)
#[tauri::command]
pub async fn import_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    strict_mode: Option<bool>,
    max_rows: Option<usize>,
    custom_field_mapping: Option<std::collections::HashMap<String, Vec<String>>>,
) -> Result<ImportResult, String> {
    info!("📁 Importing file: {}", file_path);

    match import_file_impl(&file_path, strict_mode, max_rows, custom_field_mapping).await {
        Ok(result) => {
            info!(
                "✅ Successfully imported {} items from {}",
                result.imported_data.len(),
                file_path
            );
            Ok(result)
        }
        Err(e) => {
            error!("❌ Failed to import file: {}", e);
            Err(e.to_string())
        }
    }
}

/// Import tasks from a file and enqueue them immediately in the download manager
#[tauri::command]
pub async fn import_tasks_and_enqueue(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    _encoding: Option<String>,
    field_mapping: Option<std::collections::HashMap<String, String>>,
    output_dir: Option<String>,
) -> Result<Vec<VideoTask>, String> {
    info!("\u{1F4E6} Importing and enqueuing tasks: {}", file_path);

    let converted_mapping = field_mapping.map(|mapping| {
        mapping
            .into_iter()
            .map(|(key, value)| (key, vec![value]))
            .collect::<std::collections::HashMap<String, Vec<String>>>()
    });

    let import_result = import_file(
        app,
        state.clone(),
        file_path.clone(),
        Some(false),
        None,
        converted_mapping,
    )
    .await?;

    if import_result.imported_data.is_empty() {
        info!("No valid rows detected in {}", file_path);
        return Ok(Vec::new());
    }

    let config = state.config.read().await.clone();
    let base_dir = output_dir.unwrap_or_else(|| config.download.output_directory.clone());
    let base_path = PathBuf::from(base_dir);

    let mut manager = state.download_manager.write().await;
    let mut created_tasks = Vec::new();
    let mut skipped_duplicates = Vec::new();
    let mut failed_items = Vec::new();

    for (index, record) in import_result.imported_data.iter().enumerate() {
        match build_task_from_import(record, &base_path, index) {
            Ok(task) => match manager.add_video_task(task.clone()).await {
                Ok(()) => created_tasks.push(task),
                Err(AppError::Config(msg)) if msg.contains("Duplicate task") => {
                    skipped_duplicates.push(record.record_url.clone().unwrap_or_default());
                    warn!(
                        "Skipped duplicate task for URL: {}",
                        record.record_url.as_deref().unwrap_or("unknown")
                    );
                }
                Err(error) => {
                    failed_items.push(format!(
                        "{}: {}",
                        record.record_url.as_deref().unwrap_or("unknown"),
                        error
                    ));
                    error!("Failed to enqueue task: {}", error);
                }
            },
            Err(err) => {
                failed_items.push(err);
            }
        }
    }

    drop(manager);

    info!(
        "\u{2705} Enqueued {} tasks ({} duplicates skipped, {} failed)",
        created_tasks.len(),
        skipped_duplicates.len(),
        failed_items.len()
    );

    if !failed_items.is_empty() {
        warn!("{} tasks failed to import", failed_items.len());
    }

    Ok(created_tasks)
}

fn build_task_from_import(
    record: &ImportedData,
    base_path: &PathBuf,
    index: usize,
) -> Result<VideoTask, String> {
    let url = record
        .record_url
        .as_ref()
        .or(record.url.as_ref())
        .ok_or_else(|| format!("Missing video URL for row {}", index + 1))?
        .clone();

    let title = record
        .kc_name
        .as_ref()
        .or(record.course_name.as_ref())
        .or(record.zl_name.as_ref())
        .or(record.name.as_ref())
        .cloned()
        .unwrap_or_else(|| format!("Imported Video {}", index + 1));

    let sanitized_folder = {
        let candidate = sanitize_filename(&title);
        if candidate.is_empty() {
            format!("video_{}", index + 1)
        } else {
            candidate
        }
    };

    let output_path = base_path.join(&sanitized_folder);
    let output_path_str = output_path.to_string_lossy().to_string();

    let now = Utc::now();

    Ok(VideoTask {
        id: Uuid::new_v4().to_string(),
        url,
        title,
        output_path: output_path_str,
        status: TaskStatus::Pending,
        progress: 0.0,
        file_size: None,
        downloaded_size: 0,
        speed: 0.0,
        eta: None,
        error_message: None,
        created_at: now,
        updated_at: now,
        downloader_type: Some(DownloaderType::Http),
        video_info: build_video_info(record),
    })
}

fn build_video_info(record: &ImportedData) -> Option<VideoInfo> {
    if record.zl_id.is_none()
        && record.zl_name.is_none()
        && record.record_url.is_none()
        && record.kc_id.is_none()
        && record.kc_name.is_none()
        && record.id.is_none()
        && record.name.is_none()
        && record.url.is_none()
        && record.course_id.is_none()
        && record.course_name.is_none()
    {
        None
    } else {
        Some(VideoInfo {
            zl_id: record.zl_id.clone(),
            zl_name: record.zl_name.clone(),
            record_url: record.record_url.clone(),
            kc_id: record.kc_id.clone(),
            kc_name: record.kc_name.clone(),
            id: record.id.clone(),
            name: record.name.clone(),
            url: record.url.clone(),
            course_id: record.course_id.clone(),
            course_name: record.course_name.clone(),
        })
    }
}

/// Import tasks from a CSV file (legacy compatibility)
#[tauri::command]
pub async fn import_csv_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    encoding: Option<String>,
    field_mapping: Option<std::collections::HashMap<String, String>>,
) -> Result<Vec<ImportedData>, String> {
    info!("📄 Importing CSV file (legacy): {}", file_path);

    // Convert field mapping format: HashMap<String, String> -> HashMap<String, Vec<String>>
    let converted_mapping = field_mapping.map(|mapping| {
        mapping
            .into_iter()
            .map(|(key, value)| (key, vec![value]))
            .collect::<std::collections::HashMap<String, Vec<String>>>()
    });

    // Convert to new import system with proper field mapping
    let result = import_file(app, state, file_path, Some(false), None, converted_mapping).await?;
    Ok(result.imported_data)
}

/// Import tasks from an Excel file (legacy compatibility)
#[tauri::command]
pub async fn import_excel_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    sheet_name: Option<String>,
    field_mapping: Option<std::collections::HashMap<String, String>>,
) -> Result<Vec<ImportedData>, String> {
    info!(
        "📊 Importing Excel file (legacy): {} (sheet: {:?})",
        file_path, sheet_name
    );

    // Convert field mapping format: HashMap<String, String> -> HashMap<String, Vec<String>>
    let converted_mapping = field_mapping.map(|mapping| {
        mapping
            .into_iter()
            .map(|(key, value)| (key, vec![value]))
            .collect::<std::collections::HashMap<String, Vec<String>>>()
    });

    // Convert to new import system with proper field mapping
    let result = import_file(app, state, file_path, Some(false), None, converted_mapping).await?;
    Ok(result.imported_data)
}

/// Detect file encoding using advanced detection
#[tauri::command]
pub async fn detect_file_encoding(file_path: String) -> Result<EncodingDetection, String> {
    info!("🔍 Detecting encoding for file: {}", file_path);

    match detect_file_encoding_impl(&file_path).await {
        Ok(detection) => {
            info!(
                "✅ Detected encoding: {} (confidence: {})",
                detection.encoding, detection.confidence
            );
            Ok(detection)
        }
        Err(e) => {
            error!("❌ Failed to detect encoding: {}", e);
            Err(e.to_string())
        }
    }
}

/// Preview import data before actual import
#[tauri::command]
pub async fn preview_import_data(
    file_path: String,
    max_rows: Option<usize>,
) -> Result<ImportPreview, String> {
    info!("👁️ Previewing import data: {}", file_path);

    match preview_import_data_impl(&file_path, max_rows).await {
        Ok(preview) => {
            info!(
                "✅ Generated preview with {} headers and {} rows",
                preview.headers.len(),
                preview.rows.len()
            );
            Ok(preview)
        }
        Err(e) => {
            error!("❌ Failed to preview import data: {}", e);
            Err(e.to_string())
        }
    }
}

/// Get supported file formats and their extensions
#[tauri::command]
pub async fn get_supported_formats() -> Result<SupportedFormats, String> {
    Ok(SupportedFormats {
        formats: vec![
            FileFormatInfo {
                name: "CSV".to_string(),
                extensions: vec!["csv".to_string(), "tsv".to_string(), "txt".to_string()],
                description: "逗号分隔值文件，支持多种分隔符".to_string(),
                supports_multiple_sheets: false,
            },
            FileFormatInfo {
                name: "Excel".to_string(),
                extensions: vec!["xlsx".to_string(), "xls".to_string(), "ods".to_string()],
                description: "Microsoft Excel 工作簿文件".to_string(),
                supports_multiple_sheets: true,
            },
        ],
        encodings: vec![
            "UTF-8".to_string(),
            "GBK".to_string(),
            "GB18030".to_string(),
            "Big5".to_string(),
            "Shift-JIS".to_string(),
            "UTF-16LE".to_string(),
            "UTF-16BE".to_string(),
        ],
    })
}

// Implementation functions

async fn import_file_impl(
    file_path: &str,
    strict_mode: Option<bool>,
    max_rows: Option<usize>,
    custom_field_mapping: Option<std::collections::HashMap<String, Vec<String>>>,
) -> AppResult<ImportResult> {
    // Check if file exists
    if !Path::new(file_path).exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("File not found: {}", file_path),
        )));
    }

    // Get file size
    let file_size = std::fs::metadata(file_path)
        .map_err(|e| AppError::Io(e))?
        .len();

    // Create parser configuration
    let mut config = FileParserConfig::default();
    config.strict_mode = strict_mode.unwrap_or(false);
    if let Some(max) = max_rows {
        config.max_rows = max;
    }

    // Apply custom field mapping if provided
    if let Some(custom_mapping) = custom_field_mapping {
        apply_custom_field_mapping(&mut config.field_mapping, custom_mapping);
    }

    // Create parser and parse file
    let parser = FileParser::with_config(config);
    let (video_records, stats) = parser
        .parse_file(file_path)
        .await
        .map_err(|e| AppError::Parse(format!("File parsing failed: {}", e)))?;

    // Convert VideoRecord to ImportedData
    let imported_data = video_records
        .into_iter()
        .map(|record| convert_video_record_to_imported_data(record))
        .collect();

    // Create result
    let result = ImportResult {
        imported_data,
        statistics: ImportStatistics {
            total_rows: stats.total_rows,
            parsed_rows: stats.parsed_rows,
            skipped_rows: stats.skipped_rows,
            parse_time_ms: stats.parse_time_ms,
            file_size,
        },
        file_format: format!("{:?}", stats.file_format),
        encoding: stats.detected_encoding,
    };

    Ok(result)
}

async fn detect_file_encoding_impl(file_path: &str) -> AppResult<EncodingDetection> {
    // Use the sophisticated EncodingDetector from file_parser
    let detector = EncodingDetector::new();
    let detected_encoding = detector
        .detect_encoding(file_path)
        .map_err(|e| AppError::Parse(format!("Encoding detection failed: {}", e)))?;

    // Calculate confidence based on encoding type
    let confidence = match detected_encoding.name() {
        "UTF-8" => 0.9,
        "GBK" | "GB18030" => 0.8,
        "BIG5" => 0.7,
        "SHIFT_JIS" => 0.7,
        "UTF-16LE" | "UTF-16BE" => 0.85,
        _ => 0.6,
    };

    // Determine language based on encoding
    let language = match detected_encoding.name() {
        "GBK" | "GB18030" => Some("zh-CN".to_string()),
        "BIG5" => Some("zh-TW".to_string()),
        "SHIFT_JIS" => Some("ja".to_string()),
        _ => None,
    };

    Ok(EncodingDetection {
        encoding: detected_encoding.name().to_string(),
        confidence,
        language,
    })
}

async fn preview_import_data_impl(
    file_path: &str,
    max_rows: Option<usize>,
) -> AppResult<ImportPreview> {
    let max_rows = max_rows.unwrap_or(10);

    // Create parser configuration for preview
    let mut config = FileParserConfig::default();
    config.max_rows = max_rows;
    config.strict_mode = false; // Use lenient mode for preview

    // Create parser and get preview data
    let parser = FileParser::with_config(config);
    let (video_records, stats) = parser
        .parse_file(file_path)
        .await
        .map_err(|e| AppError::Parse(format!("Failed to preview file: {}", e)))?;

    // Extract headers from first record or use default field names
    let headers = if video_records.is_empty() {
        vec![
            "column_id".to_string(),
            "column_name".to_string(),
            "course_id".to_string(),
            "course_name".to_string(),
            "video_url".to_string(),
        ]
    } else {
        // Use field names from the parser's field mapping
        vec![
            "专栏ID".to_string(),
            "专栏名称".to_string(),
            "课程ID".to_string(),
            "课程名称".to_string(),
            "视频链接".to_string(),
        ]
    };

    // Convert VideoRecords to preview rows
    let rows: Vec<Vec<String>> = video_records
        .iter()
        .map(|record| {
            vec![
                record.column_id.clone(),
                record.column_name.clone(),
                record.course_id.clone(),
                record.course_name.clone(),
                record.video_url.clone(),
            ]
        })
        .collect();

    // Generate field mapping for UI
    let mut field_mapping = std::collections::HashMap::new();
    field_mapping.insert("专栏ID".to_string(), "id".to_string());
    field_mapping.insert("专栏名称".to_string(), "name".to_string());
    field_mapping.insert("课程ID".to_string(), "course_id".to_string());
    field_mapping.insert("课程名称".to_string(), "course_name".to_string());
    field_mapping.insert("视频链接".to_string(), "url".to_string());

    Ok(ImportPreview {
        headers,
        rows,
        total_rows: stats.total_rows,
        encoding: stats.detected_encoding,
        field_mapping,
    })
}

// Helper functions

/// Apply custom field mappings to the parser configuration
fn apply_custom_field_mapping(
    field_mapping: &mut FieldMapping,
    custom_mapping: std::collections::HashMap<String, Vec<String>>,
) {
    for (field_name, aliases) in custom_mapping {
        match field_name.as_str() {
            "column_id" | "id" => {
                field_mapping.column_id_names.extend(aliases);
            }
            "column_name" | "name" => {
                field_mapping.column_name_names.extend(aliases);
            }
            "course_id" => {
                field_mapping.course_id_names.extend(aliases);
            }
            "course_name" => {
                field_mapping.course_name_names.extend(aliases);
            }
            "video_url" | "url" => {
                field_mapping.video_url_names.extend(aliases);
            }
            _ => {
                debug!("Unknown field mapping: {} -> {:?}", field_name, aliases);
            }
        }
    }
}

/// Convert VideoRecord to ImportedData
fn convert_video_record_to_imported_data(record: VideoRecord) -> ImportedData {
    // Helper function to convert empty strings to None
    let optional_string = |s: String| -> Option<String> {
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    };

    ImportedData {
        // 使用Go版本的标准字段名 - 现在都是可选的
        zl_id: optional_string(record.column_id.clone()),
        zl_name: optional_string(record.column_name.clone()),
        record_url: optional_string(record.video_url.clone()),
        kc_id: optional_string(record.course_id.clone()),
        kc_name: optional_string(record.course_name.clone()),

        // 兼容旧版本字段
        id: optional_string(record.column_id),
        name: optional_string(record.column_name),
        url: optional_string(record.video_url),
        course_id: optional_string(record.course_id),
        course_name: optional_string(record.course_name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::file_parser::VideoRecord;

    #[test]
    fn test_convert_video_record_to_imported_data() {
        let video_record = VideoRecord {
            column_id: "123".to_string(),
            column_name: "Test Column".to_string(),
            course_id: "456".to_string(),
            course_name: "Test Course".to_string(),
            video_url: "https://example.com/video.mp4".to_string(),
        };

        let imported_data = convert_video_record_to_imported_data(video_record);

        assert_eq!(imported_data.id, "123");
        assert_eq!(imported_data.name, "Test Column");
        assert_eq!(imported_data.url, "https://example.com/video.mp4");
        assert_eq!(imported_data.course_id, Some("456".to_string()));
        assert_eq!(imported_data.course_name, Some("Test Course".to_string()));
    }

    #[test]
    fn test_convert_video_record_with_empty_fields() {
        let video_record = VideoRecord {
            column_id: "123".to_string(),
            column_name: "Test Column".to_string(),
            course_id: "".to_string(),   // Empty course_id
            course_name: "".to_string(), // Empty course_name
            video_url: "https://example.com/video.mp4".to_string(),
        };

        let imported_data = convert_video_record_to_imported_data(video_record);

        assert_eq!(imported_data.id, "123");
        assert_eq!(imported_data.name, "Test Column");
        assert_eq!(imported_data.url, "https://example.com/video.mp4");
        assert_eq!(imported_data.course_id, None); // Should be None for empty string
        assert_eq!(imported_data.course_name, None); // Should be None for empty string
    }

    #[test]
    fn test_apply_custom_field_mapping() {
        let mut field_mapping = FieldMapping::default();
        let mut custom_mapping = std::collections::HashMap::new();

        custom_mapping.insert(
            "column_id".to_string(),
            vec!["custom_id".to_string(), "my_id".to_string()],
        );
        custom_mapping.insert("video_url".to_string(), vec!["download_link".to_string()]);

        apply_custom_field_mapping(&mut field_mapping, custom_mapping);

        assert!(field_mapping
            .column_id_aliases
            .contains(&"custom_id".to_string()));
        assert!(field_mapping
            .column_id_aliases
            .contains(&"my_id".to_string()));
        assert!(field_mapping
            .video_url_aliases
            .contains(&"download_link".to_string()));
    }
}
