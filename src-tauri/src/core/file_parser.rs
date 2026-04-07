//! 文件解析模块
//!
//! 提供CSV和Excel文件的解析功能，支持多种编码格式和自动编码检测，
//! 专门用于批量视频下载任务的文件导入功能。
//!
//! ## 功能特性
//!
//! - **多格式支持**: CSV、Excel (XLS/XLSX) 文件解析
//! - **编码检测**: 自动检测文件编码，支持UTF-8、GBK、GB2312、Shift-JIS等
//! - **乱码防护**: 智能编码转换，防止中文乱码问题
//! - **流式处理**: 大文件流式读取，内存友好
//! - **错误恢复**: 容错处理，跳过损坏的行或单元格
//! - **字段映射**: 灵活的列名映射，支持中英文表头

use crate::core::models::ImportPreview;
use anyhow::{anyhow, Result};
use calamine::{open_workbook_auto, DataType, Reader, Sheets};
use chardetng::EncodingDetector as ChardetngDetector;
use csv::ReaderBuilder;
use encoding_rs::{Encoding, BIG5, EUC_JP, GB18030, GBK, SHIFT_JIS, UTF_8};
use encoding_rs_io::DecodeReaderBytesBuilder;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Read, Seek},
    path::Path,
};
use tracing::{debug, error, info, warn};

/// 解析结果统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseStats {
    /// 总行数
    pub total_rows: usize,
    /// 成功解析的行数
    pub parsed_rows: usize,
    /// 跳过的行数（空行或错误行）
    pub skipped_rows: usize,
    /// 检测到的文件编码
    pub detected_encoding: String,
    /// 文件格式
    pub file_format: FileFormat,
    /// 解析耗时（毫秒）
    pub parse_time_ms: u64,
}

/// 支持的文件格式
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum FileFormat {
    /// CSV 格式
    Csv,
    /// Excel 格式 (XLS/XLSX)
    Excel,
}

/// 视频信息记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoRecord {
    /// 专栏ID
    pub column_id: String,
    /// 专栏名称
    pub column_name: String,
    /// 课程ID
    pub course_id: String,
    /// 课程名称
    pub course_name: String,
    /// 视频下载链接
    pub video_url: String,
    /// 原始行号（用于错误定位）
    pub source_row: usize,
}

/// 列名映射配置
#[derive(Debug, Clone)]
pub struct FieldMapping {
    /// 专栏ID列名的可能变体
    pub column_id_names: Vec<String>,
    /// 专栏名称列名的可能变体
    pub column_name_names: Vec<String>,
    /// 课程ID列名的可能变体
    pub course_id_names: Vec<String>,
    /// 课程名称列名的可能变体
    pub course_name_names: Vec<String>,
    /// 视频链接列名的可能变体
    pub video_url_names: Vec<String>,
}

/// 文件解析器配置
#[derive(Debug, Clone)]
pub struct FileParserConfig {
    /// 字段映射规则
    pub field_mapping: FieldMapping,
    /// 是否严格模式（严格要求所有字段）
    pub strict_mode: bool,
    /// 最大解析行数（0表示无限制）
    pub max_rows: usize,
    /// 是否跳过空行
    pub skip_empty_rows: bool,
    /// CSV分隔符（None表示自动检测）
    pub csv_delimiter: Option<u8>,
}

/// 增强型编码检测器
///
/// 使用多层次检测策略，确保中文编码的准确识别
pub struct EncodingDetector {
    /// 检测缓冲区大小
    buffer_size: usize,
    /// 是否启用深度检测模式（更准确但更慢）
    deep_detection: bool,
    /// 优先检测的编码列表
    priority_encodings: Vec<&'static Encoding>,
}

/// 文件解析器主结构
pub struct FileParser {
    config: FileParserConfig,
    encoding_detector: EncodingDetector,
}

impl Default for FieldMapping {
    fn default() -> Self {
        Self {
            column_id_names: vec![
                "zl_id".to_string(),
                "专栏ID".to_string(),
                "专栏id".to_string(),
                "column_id".to_string(),
                "columnId".to_string(),
                "Column ID".to_string(),
            ],
            column_name_names: vec![
                "zl_name".to_string(),
                "专栏名称".to_string(),
                "专栏名".to_string(),
                "column_name".to_string(),
                "columnName".to_string(),
                "Column Name".to_string(),
            ],
            course_id_names: vec![
                "kc_id".to_string(),
                "课程ID".to_string(),
                "课程id".to_string(),
                "course_id".to_string(),
                "courseId".to_string(),
                "Course ID".to_string(),
            ],
            course_name_names: vec![
                "kc_name".to_string(),
                "课程名称".to_string(),
                "课程名".to_string(),
                "course_name".to_string(),
                "courseName".to_string(),
                "Course Name".to_string(),
                "title".to_string(),
                "标题".to_string(),
            ],
            video_url_names: vec![
                "record_url".to_string(),
                "视频链接".to_string(),
                "下载链接".to_string(),
                "video_url".to_string(),
                "videoUrl".to_string(),
                "url".to_string(),
                "link".to_string(),
                "链接".to_string(),
            ],
        }
    }
}

impl Default for FileParserConfig {
    fn default() -> Self {
        Self {
            field_mapping: FieldMapping::default(),
            strict_mode: false,
            max_rows: 0,
            skip_empty_rows: true,
            csv_delimiter: None,
        }
    }
}

impl Default for EncodingDetector {
    fn default() -> Self {
        Self {
            buffer_size: 8192,
            deep_detection: true,
            priority_encodings: vec![UTF_8, GBK, GB18030, BIG5, SHIFT_JIS, EUC_JP],
        }
    }
}

impl EncodingDetector {
    /// 创建新的编码检测器
    pub fn new() -> Self {
        Self::default()
    }

    /// 设置检测缓冲区大小
    pub fn with_buffer_size(mut self, size: usize) -> Self {
        self.buffer_size = size;
        self
    }

    /// 启用/禁用深度检测模式
    pub fn with_deep_detection(mut self, enabled: bool) -> Self {
        self.deep_detection = enabled;
        self
    }

    /// 设置优先检测的编码列表
    pub fn with_priority_encodings(mut self, encodings: Vec<&'static Encoding>) -> Self {
        self.priority_encodings = encodings;
        self
    }

    /// 检测文件编码
    ///
    /// 使用多层次检测策略：
    /// 1. BOM检测
    /// 2. chardetng智能检测
    /// 3. 启发式中文编码检测
    /// 4. 回退到UTF-8
    pub fn detect_encoding<P: AsRef<Path>>(&self, file_path: P) -> Result<&'static Encoding> {
        let path = file_path.as_ref();
        debug!("开始检测文件编码: {}", path.display());

        let mut file = File::open(path)?;
        let mut buffer = vec![0; self.buffer_size];
        let bytes_read = file.read(&mut buffer)?;

        if bytes_read == 0 {
            debug!("文件为空，使用UTF-8编码");
            return Ok(UTF_8);
        }

        let sample = &buffer[..bytes_read];

        // 第一步：检查BOM
        if let Some(encoding) = self.detect_bom(sample) {
            debug!("通过BOM检测到编码: {}", encoding.name());
            return Ok(encoding);
        }

        // 第二步：使用chardetng进行智能检测
        if let Some(encoding) = self.chardetng_detect(sample) {
            debug!("通过chardetng检测到编码: {}", encoding.name());
            return Ok(encoding);
        }

        // 第三步：使用启发式方法检测中文编码
        let encoding = self.heuristic_detect(sample);
        debug!("通过启发式检测到编码: {}", encoding.name());

        Ok(encoding)
    }

    /// BOM检测
    fn detect_bom(&self, data: &[u8]) -> Option<&'static Encoding> {
        if data.len() >= 3 {
            // UTF-8 BOM
            if data[0..3] == [0xEF, 0xBB, 0xBF] {
                return Some(UTF_8);
            }
        }

        if data.len() >= 2 {
            // UTF-16 LE BOM
            if data[0..2] == [0xFF, 0xFE] {
                return Some(encoding_rs::UTF_16LE);
            }
            // UTF-16 BE BOM
            if data[0..2] == [0xFE, 0xFF] {
                return Some(encoding_rs::UTF_16BE);
            }
        }

        None
    }

    /// 使用chardetng进行编码检测
    fn chardetng_detect(&self, data: &[u8]) -> Option<&'static Encoding> {
        let mut detector = ChardetngDetector::new();
        detector.feed(data, true);
        let detected_encoding = detector.guess(None, true);

        // 验证检测结果的置信度
        if self.validate_encoding_guess(data, detected_encoding) {
            Some(detected_encoding)
        } else {
            None
        }
    }

    /// 验证编码猜测的准确性
    fn validate_encoding_guess(&self, data: &[u8], encoding: &'static Encoding) -> bool {
        // 尝试解码一部分数据来验证编码正确性
        let (decoded, _, has_errors) = encoding.decode(data);

        // 如果没有解码错误，并且包含合理的字符，则认为是有效的
        !has_errors && self.is_reasonable_text(&decoded)
    }

    /// 检查解码后的文本是否合理
    fn is_reasonable_text(&self, text: &str) -> bool {
        // 检查是否包含合理的字符分布
        let mut ascii_count = 0;
        let mut chinese_count = 0;
        let mut other_count = 0;
        let mut control_count = 0;

        for ch in text.chars() {
            match ch {
                '\u{0000}'..='\u{001F}' => control_count += 1, // 控制字符
                '\u{0000}'..='\u{007F}' => ascii_count += 1,
                '\u{4E00}'..='\u{9FFF}' => chinese_count += 1, // CJK统一汉字
                '\u{3400}'..='\u{4DBF}' => chinese_count += 1, // CJK扩展A
                _ => other_count += 1,
            }
        }

        let total = ascii_count + chinese_count + other_count + control_count;
        if total == 0 {
            return false;
        }

        // 控制字符不应该太多（除了换行符等常见的）
        let control_ratio = control_count as f64 / total as f64;
        if control_ratio > 0.1 {
            return false;
        }

        // 应该包含一定比例的可打印字符
        let printable_ratio = (ascii_count + chinese_count + other_count) as f64 / total as f64;
        printable_ratio > 0.7
    }

    /// 启发式编码检测（用于chardetng失败的情况）
    fn heuristic_detect(&self, data: &[u8]) -> &'static Encoding {
        // 首先尝试UTF-8
        if std::str::from_utf8(data).is_ok() {
            return UTF_8;
        }

        // 尝试优先编码列表
        for &encoding in &self.priority_encodings {
            if encoding == UTF_8 {
                continue; // 已经尝试过了
            }

            let (decoded, _, has_errors) = encoding.decode(data);
            if !has_errors && self.is_reasonable_text(&decoded) {
                return encoding;
            }
        }

        // 使用统计方法检测中文编码
        self.statistical_chinese_detect(data)
    }

    /// 统计方法检测中文编码
    fn statistical_chinese_detect(&self, data: &[u8]) -> &'static Encoding {
        let mut gbk_score = 0i32;
        let mut big5_score = 0i32;
        let mut shift_jis_score = 0i32;

        let mut i = 0;
        while i + 1 < data.len() {
            let b1 = data[i];
            let b2 = data[i + 1];

            // GBK/GB18030 检测
            if self.is_gbk_range(b1, b2) {
                gbk_score += 2;
            }

            // Big5 检测
            if self.is_big5_range(b1, b2) {
                big5_score += 2;
            }

            // Shift-JIS 检测
            if self.is_shift_jis_range(b1, b2) {
                shift_jis_score += 1;
            }

            i += 1;
        }

        debug!(
            "编码统计分数 - GBK: {}, Big5: {}, Shift-JIS: {}",
            gbk_score, big5_score, shift_jis_score
        );

        // 选择得分最高的编码
        if gbk_score >= big5_score && gbk_score >= shift_jis_score && gbk_score > 0 {
            GBK
        } else if big5_score >= shift_jis_score && big5_score > 0 {
            BIG5
        } else if shift_jis_score > 0 {
            SHIFT_JIS
        } else {
            UTF_8 // 默认回退
        }
    }

    /// 检查是否在GBK范围内
    fn is_gbk_range(&self, b1: u8, b2: u8) -> bool {
        // GBK编码范围：第一字节0x81-0xFE，第二字节0x40-0xFE（除了0x7F）
        (0x81..=0xFE).contains(&b1) && ((0x40..=0x7E).contains(&b2) || (0x80..=0xFE).contains(&b2))
    }

    /// 检查是否在Big5范围内
    fn is_big5_range(&self, b1: u8, b2: u8) -> bool {
        // Big5编码范围
        (0x81..=0xFE).contains(&b1) && ((0x40..=0x7E).contains(&b2) || (0xA1..=0xFE).contains(&b2))
    }

    /// 检查是否在Shift-JIS范围内
    fn is_shift_jis_range(&self, b1: u8, b2: u8) -> bool {
        // Shift-JIS编码范围
        ((0x81..=0x9F).contains(&b1) || (0xE0..=0xEF).contains(&b1))
            && ((0x40..=0x7E).contains(&b2) || (0x80..=0xFC).contains(&b2))
    }

    /// 创建编码转换读取器
    ///
    /// 将任意编码的文件转换为UTF-8流，用于CSV解析
    pub fn create_decode_reader<R: Read + 'static>(
        &self,
        reader: R,
        encoding: &'static Encoding,
    ) -> Box<dyn BufRead + 'static> {
        if encoding == UTF_8 {
            // 如果已经是UTF-8，直接使用BufReader
            Box::new(BufReader::new(reader))
        } else {
            // 使用encoding_rs_io进行编码转换
            let decode_reader = DecodeReaderBytesBuilder::new()
                .encoding(Some(encoding))
                .build(reader);
            Box::new(BufReader::new(decode_reader))
        }
    }

    /// 检测并创建转换读取器
    pub fn detect_and_create_reader<P: AsRef<Path>>(
        &self,
        file_path: P,
    ) -> Result<(Box<dyn BufRead>, &'static Encoding)> {
        let path = file_path.as_ref();
        let encoding = self.detect_encoding(path)?;
        let file = File::open(path)?;
        let reader = self.create_decode_reader(file, encoding);
        Ok((reader, encoding))
    }
}

#[cfg(all(test, feature = "integration-tests"))]
impl EncodingDetector {
    pub(crate) fn buffer_size_for_tests(&self) -> usize {
        self.buffer_size
    }

    pub(crate) fn deep_detection_for_tests(&self) -> bool {
        self.deep_detection
    }

    pub(crate) fn priority_encodings_for_tests(&self) -> &[&'static Encoding] {
        &self.priority_encodings
    }

    pub(crate) fn test_is_reasonable_text(&self, text: &str) -> bool {
        self.is_reasonable_text(text)
    }

    pub(crate) fn test_statistical_chinese_detect(&self, data: &[u8]) -> &'static Encoding {
        self.statistical_chinese_detect(data)
    }

    pub(crate) fn test_detect_bom(&self, data: &[u8]) -> Option<&'static Encoding> {
        self.detect_bom(data)
    }

    pub(crate) fn test_is_gbk_range(&self, b1: u8, b2: u8) -> bool {
        self.is_gbk_range(b1, b2)
    }

    pub(crate) fn test_is_big5_range(&self, b1: u8, b2: u8) -> bool {
        self.is_big5_range(b1, b2)
    }

    pub(crate) fn test_is_shift_jis_range(&self, b1: u8, b2: u8) -> bool {
        self.is_shift_jis_range(b1, b2)
    }
}

#[cfg(all(test, feature = "integration-tests"))]
impl FileParser {
    pub(crate) fn test_detect_file_format<P: AsRef<Path>>(
        &self,
        file_path: P,
    ) -> Result<FileFormat> {
        self.detect_file_format(file_path)
    }
}

impl FileParser {
    /// 创建新的文件解析器
    pub fn new() -> Self {
        Self {
            config: FileParserConfig::default(),
            encoding_detector: EncodingDetector::new(),
        }
    }

    /// 使用自定义配置创建解析器
    pub fn with_config(config: FileParserConfig) -> Self {
        Self {
            config,
            encoding_detector: EncodingDetector::new(),
        }
    }

    /// 解析文件（自动检测格式）
    pub async fn parse_file<P: AsRef<Path>>(
        &self,
        file_path: P,
    ) -> Result<(Vec<VideoRecord>, ParseStats)> {
        let path = file_path.as_ref();
        info!("开始解析文件: {}", path.display());

        let start_time = std::time::Instant::now();

        // 检测文件格式
        let format = self.detect_file_format(path)?;

        // 根据格式选择解析方法
        let result = match format {
            FileFormat::Csv => self.parse_csv_file(path).await,
            FileFormat::Excel => self.parse_excel_file(path).await,
        };

        match result {
            Ok(mut data) => {
                let elapsed = start_time.elapsed();
                data.1.parse_time_ms = elapsed.as_millis() as u64;
                data.1.file_format = format;

                info!(
                    "文件解析完成: {} 条记录，耗时: {}ms",
                    data.1.parsed_rows, data.1.parse_time_ms
                );
                Ok(data)
            }
            Err(e) => {
                error!("文件解析失败: {}: {}", path.display(), e);
                Err(e)
            }
        }
    }

    /// �����ļ���Ԥ����Ϣ����ʵ����ͷ��Ԥ��������Ϣ
    pub fn generate_preview<P: AsRef<Path>>(
        &self,
        file_path: P,
        max_rows: usize,
    ) -> Result<ImportPreview> {
        let path = file_path.as_ref();
        let row_limit = if max_rows == 0 { 10 } else { max_rows };
        match self.detect_file_format(path)? {
            FileFormat::Csv => self.generate_csv_preview(path, row_limit),
            FileFormat::Excel => self.generate_excel_preview(path, row_limit),
        }
    }

    fn generate_csv_preview(&self, path: &Path, max_rows: usize) -> Result<ImportPreview> {
        let (reader, encoding) = self.encoding_detector.detect_and_create_reader(path)?;
        let delimiter = self.detect_csv_delimiter(reader, &self.config.csv_delimiter)?;
        let (reader, _) = self.encoding_detector.detect_and_create_reader(path)?;

        let mut csv_reader = ReaderBuilder::new()
            .delimiter(delimiter)
            .has_headers(true)
            .flexible(true)
            .trim(csv::Trim::All)
            .from_reader(reader);

        let original_headers = csv_reader.headers()?.clone();
        let mut headers: Vec<String> = original_headers
            .iter()
            .enumerate()
            .map(|(idx, header)| Self::normalize_header_name(header, idx))
            .collect();

        let mut field_mapping = HashMap::new();
        if !original_headers.is_empty() {
            if let Ok(mapping) = self.build_field_mapping(&original_headers) {
                for (canonical, index) in mapping {
                    if let Some(header) = original_headers.get(index) {
                        let normalized = Self::normalize_header_name(header, index);
                        field_mapping.insert(normalized, canonical);
                    }
                }
            }
        }

        let mut rows = Vec::new();
        let mut total_rows = 0usize;

        for result in csv_reader.records() {
            match result {
                Ok(record) => {
                    if self.config.skip_empty_rows && self.is_empty_record(&record) {
                        continue;
                    }

                    if headers.is_empty() {
                        headers = (0..record.len())
                            .map(|idx| format!("Column {}", idx + 1))
                            .collect();
                    }

                    if record.len() > headers.len() {
                        for idx in headers.len()..record.len() {
                            headers.push(format!("Column {}", idx + 1));
                        }
                    }

                    total_rows += 1;
                    if rows.len() < max_rows {
                        let column_count = headers.len().max(record.len());
                        rows.push(Self::string_record_to_row(&record, column_count));
                    }
                }
                Err(e) => {
                    warn!("CSV preview read error: {}", e);
                    if self.config.strict_mode {
                        return Err(anyhow!("CSV预览失败: {}", e));
                    }
                }
            }
        }

        if headers.is_empty() {
            headers = vec![
                "ר��ID".to_string(),
                "ר������".to_string(),
                "�γ�ID".to_string(),
                "�γ�����".to_string(),
                "��Ƶ����".to_string(),
            ];
        }

        Ok(ImportPreview {
            headers,
            rows,
            total_rows,
            encoding: encoding.name().to_string(),
            field_mapping,
        })
    }

    fn generate_excel_preview(&self, path: &Path, max_rows: usize) -> Result<ImportPreview> {
        let mut workbook = open_workbook_auto(path).map_err(|e| anyhow!("�޷���Excel�ļ�: {}", e))?;
        let sheet_names = workbook.sheet_names().to_owned();
        if sheet_names.is_empty() {
            return Err(anyhow!("Excel�ļ���û���ҵ�������"));
        }

        let sheet_name = &sheet_names[0];
        let range = workbook
            .worksheet_range(sheet_name)
            .ok_or_else(|| anyhow!("�޷�������: {}", sheet_name))?
            .map_err(|e| anyhow!("�޷���ȡ�������� '{}': {}", sheet_name, e))?;

        let mut rows_iter = range.rows();
        let header_row = rows_iter
            .next()
            .ok_or_else(|| anyhow!("Excel�ļ�ȱ��ͷ����"))?;

        let mut headers: Vec<String> = header_row
            .iter()
            .enumerate()
            .map(|(idx, cell)| self.normalize_excel_header(cell, idx))
            .collect();

        let mut field_mapping = HashMap::new();
        if let Ok(mapping) = self.build_excel_field_mapping(header_row) {
            for (canonical, index) in mapping {
                if let Some(cell) = header_row.get(index) {
                    let header_name = self.normalize_excel_header(cell, index);
                    field_mapping.insert(header_name, canonical);
                }
            }
        }

        let mut rows = Vec::new();
        let mut total_rows = 0usize;

        for row in rows_iter {
            if self.is_empty_excel_row(row) {
                continue;
            }

            total_rows += 1;

            if row.len() > headers.len() {
                for idx in headers.len()..row.len() {
                    headers.push(format!("Column {}", idx + 1));
                }
            }

            if rows.len() < max_rows {
                rows.push(self.excel_row_to_vec(row, headers.len()));
            }
        }

        if headers.is_empty() {
            headers = vec![
                "ר��ID".to_string(),
                "ר������".to_string(),
                "�γ�ID".to_string(),
                "�γ�����".to_string(),
                "��Ƶ����".to_string(),
            ];
        }

        Ok(ImportPreview {
            headers,
            rows,
            total_rows,
            encoding: "UTF-8".to_string(),
            field_mapping,
        })
    }

    fn normalize_header_name(header: &str, index: usize) -> String {
        let trimmed = header.trim();
        if trimmed.is_empty() {
            format!("Column {}", index + 1)
        } else {
            trimmed.to_string()
        }
    }

    fn normalize_excel_header(&self, cell: &DataType, index: usize) -> String {
        let value = self.datatype_to_string(cell);
        if value.trim().is_empty() {
            format!("Column {}", index + 1)
        } else {
            value
        }
    }

    fn string_record_to_row(record: &csv::StringRecord, column_count: usize) -> Vec<String> {
        (0..column_count)
            .map(|idx| record.get(idx).unwrap_or("").trim().to_string())
            .collect()
    }

    fn excel_row_to_vec(&self, row: &[DataType], column_count: usize) -> Vec<String> {
        (0..column_count)
            .map(|idx| {
                row.get(idx)
                    .map(|cell| self.datatype_to_string(cell))
                    .unwrap_or_default()
            })
            .collect()
    }

    /// 检测文件格式
    fn detect_file_format<P: AsRef<Path>>(&self, file_path: P) -> Result<FileFormat> {
        let path = file_path.as_ref();

        match path.extension().and_then(|ext| ext.to_str()) {
            Some(ext) => match ext.to_lowercase().as_str() {
                "csv" | "tsv" | "txt" => Ok(FileFormat::Csv),
                "xlsx" | "xls" | "ods" => Ok(FileFormat::Excel),
                _ => {
                    warn!("未知文件扩展名: {}，尝试作为CSV处理", ext);
                    Ok(FileFormat::Csv)
                }
            },
            None => {
                warn!("文件无扩展名，尝试作为CSV处理");
                Ok(FileFormat::Csv)
            }
        }
    }

    /// 解析CSV文件
    async fn parse_csv_file<P: AsRef<Path>>(
        &self,
        file_path: P,
    ) -> Result<(Vec<VideoRecord>, ParseStats)> {
        let path = file_path.as_ref();
        debug!("开始解析CSV文件: {}", path.display());

        // 检测编码并创建转换读取器
        let (reader, encoding) = self.encoding_detector.detect_and_create_reader(path)?;
        debug!("检测到文件编码: {}", encoding.name());

        // 创建统计信息
        let mut stats = ParseStats {
            total_rows: 0,
            parsed_rows: 0,
            skipped_rows: 0,
            detected_encoding: encoding.name().to_string(),
            file_format: FileFormat::Csv,
            parse_time_ms: 0,
        };

        // 检测CSV分隔符（如果未在配置中指定）
        let delimiter = self.detect_csv_delimiter(reader, &self.config.csv_delimiter)?;
        debug!("使用CSV分隔符: {:?}", delimiter as char);

        // 重新创建读取器（因为之前的读取器可能已经消费了一些数据）
        let (reader, _) = self.encoding_detector.detect_and_create_reader(path)?;

        // 创建CSV读取器
        let mut csv_reader = ReaderBuilder::new()
            .delimiter(delimiter)
            .has_headers(true)
            .flexible(true) // 允许行有不同数量的字段
            .trim(csv::Trim::All)
            .from_reader(reader);

        // 读取表头并建立字段映射
        let headers = csv_reader.headers()?.clone();
        let field_mapping = self.build_field_mapping(&headers)?;
        debug!("字段映射: {:?}", field_mapping);

        let mut records = Vec::new();
        let mut row_number = 1; // 从1开始，因为0是表头

        // 逐行解析CSV
        for result in csv_reader.records() {
            row_number += 1;
            stats.total_rows += 1;

            match result {
                Ok(csv_record) => {
                    if self.config.skip_empty_rows && self.is_empty_record(&csv_record) {
                        stats.skipped_rows += 1;
                        continue;
                    }

                    match self.parse_csv_record(&csv_record, &field_mapping, row_number) {
                        Ok(video_record) => {
                            records.push(video_record);
                            stats.parsed_rows += 1;
                        }
                        Err(e) => {
                            warn!("跳过第{}行，解析错误: {}", row_number, e);
                            stats.skipped_rows += 1;

                            // 严格模式下遇到错误则停止解析
                            if self.config.strict_mode {
                                return Err(anyhow!(
                                    "严格模式下解析失败在第{}行: {}",
                                    row_number,
                                    e
                                ));
                            }
                        }
                    }

                    // 检查最大行数限制
                    if self.config.max_rows > 0 && records.len() >= self.config.max_rows {
                        info!("达到最大解析行数限制: {}", self.config.max_rows);
                        break;
                    }
                }
                Err(e) => {
                    warn!("CSV读取错误在第{}行: {}", row_number, e);
                    stats.skipped_rows += 1;

                    if self.config.strict_mode {
                        return Err(anyhow!("CSV读取错误: {}", e));
                    }
                }
            }
        }

        info!(
            "CSV解析完成: 总行数={}, 成功解析={}, 跳过={}",
            stats.total_rows, stats.parsed_rows, stats.skipped_rows
        );

        Ok((records, stats))
    }

    /// 检测CSV分隔符
    fn detect_csv_delimiter<R: BufRead>(
        &self,
        mut reader: R,
        configured_delimiter: &Option<u8>,
    ) -> Result<u8> {
        // 如果配置中指定了分隔符，直接使用
        if let Some(delimiter) = configured_delimiter {
            return Ok(*delimiter);
        }

        // 读取前几行来检测分隔符
        let mut sample_lines = Vec::new();
        let mut line = String::new();
        let max_sample_lines = 5;

        for _ in 0..max_sample_lines {
            line.clear();
            if reader.read_line(&mut line)? == 0 {
                break; // EOF
            }
            sample_lines.push(line.clone());
        }

        if sample_lines.is_empty() {
            return Ok(b','); // 默认使用逗号
        }

        // 统计不同分隔符的出现频率
        let delimiters = [b',', b';', b'\t', b'|'];
        let mut delimiter_scores = HashMap::new();

        for delimiter in &delimiters {
            let mut total_fields = 0;
            let mut consistent_field_count = true;
            let mut first_line_field_count = None;

            for line in &sample_lines {
                let field_count = line.as_bytes().iter().filter(|&&b| b == *delimiter).count() + 1;

                if let Some(expected_count) = first_line_field_count {
                    if field_count != expected_count {
                        consistent_field_count = false;
                    }
                } else {
                    first_line_field_count = Some(field_count);
                }

                total_fields += field_count;
            }

            // 评分：字段总数 × 一致性奖励
            let consistency_bonus = if consistent_field_count { 2.0 } else { 1.0 };
            let score = (total_fields as f64) * consistency_bonus;
            delimiter_scores.insert(*delimiter, score);
        }

        // 选择得分最高的分隔符
        let best_delimiter = delimiter_scores
            .into_iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(delimiter, _)| delimiter)
            .unwrap_or(b',');

        debug!("自动检测到CSV分隔符: {:?}", best_delimiter as char);
        Ok(best_delimiter)
    }

    /// 构建字段映射
    fn build_field_mapping(&self, headers: &csv::StringRecord) -> Result<HashMap<String, usize>> {
        let mut field_mapping = HashMap::new();

        for (index, header) in headers.iter().enumerate() {
            let normalized_header = header.trim().to_lowercase();

            // 检查是否匹配专栏ID
            if self
                .config
                .field_mapping
                .column_id_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("column_id".to_string(), index);
            }
            // 检查是否匹配专栏名称
            else if self
                .config
                .field_mapping
                .column_name_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("column_name".to_string(), index);
            }
            // 检查是否匹配课程ID
            else if self
                .config
                .field_mapping
                .course_id_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("course_id".to_string(), index);
            }
            // 检查是否匹配课程名称
            else if self
                .config
                .field_mapping
                .course_name_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("course_name".to_string(), index);
            }
            // 检查是否匹配视频链接
            else if self
                .config
                .field_mapping
                .video_url_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("video_url".to_string(), index);
            }
        }

        // 验证必需字段是否存在
        if self.config.strict_mode {
            let required_fields = ["video_url"]; // 至少需要视频链接
            for field in &required_fields {
                if !field_mapping.contains_key(*field) {
                    return Err(anyhow!("未找到必需字段: {}", field));
                }
            }
        }

        Ok(field_mapping)
    }

    /// 检查是否为空记录
    fn is_empty_record(&self, record: &csv::StringRecord) -> bool {
        record.iter().all(|field| field.trim().is_empty())
    }

    /// 解析单个CSV记录
    fn parse_csv_record(
        &self,
        record: &csv::StringRecord,
        field_mapping: &HashMap<String, usize>,
        row_number: usize,
    ) -> Result<VideoRecord> {
        let get_field = |field_name: &str| -> String {
            field_mapping
                .get(field_name)
                .and_then(|&index| record.get(index))
                .unwrap_or("")
                .trim()
                .to_string()
        };

        let column_id = get_field("column_id");
        let column_name = get_field("column_name");
        let course_id = get_field("course_id");
        let course_name = get_field("course_name");
        let video_url = get_field("video_url");

        // 验证必需字段
        if video_url.is_empty() {
            return Err(anyhow!("视频链接不能为空"));
        }

        // 验证URL格式
        if !self.is_valid_url(&video_url) {
            return Err(anyhow!("无效的视频链接格式: {}", video_url));
        }

        Ok(VideoRecord {
            column_id,
            column_name,
            course_id,
            course_name,
            video_url,
            source_row: row_number,
        })
    }

    /// 验证URL格式
    fn is_valid_url(&self, url: &str) -> bool {
        // 简单的URL验证
        url.starts_with("http://") || url.starts_with("https://") || url.starts_with("ftp://")
    }

    /// 解析Excel文件
    async fn parse_excel_file<P: AsRef<Path>>(
        &self,
        file_path: P,
    ) -> Result<(Vec<VideoRecord>, ParseStats)> {
        let path = file_path.as_ref();
        debug!("开始解析Excel文件: {}", path.display());

        // 创建统计信息
        let mut stats = ParseStats {
            total_rows: 0,
            parsed_rows: 0,
            skipped_rows: 0,
            detected_encoding: "UTF-8".to_string(), // Excel内部使用UTF-8
            file_format: FileFormat::Excel,
            parse_time_ms: 0,
        };

        // 打开Excel工作簿（自动检测格式：XLS/XLSX/ODS）
        let mut workbook =
            open_workbook_auto(path).map_err(|e| anyhow!("无法打开Excel文件: {}", e))?;

        debug!(
            "成功打开Excel文件，工作表数量: {}",
            workbook.sheet_names().len()
        );

        // 获取所有工作表名称
        let sheet_names = workbook.sheet_names().to_owned();
        if sheet_names.is_empty() {
            return Err(anyhow!("Excel文件中没有找到工作表"));
        }

        let mut all_records = Vec::new();

        // 遍历所有工作表
        for sheet_name in &sheet_names {
            debug!("开始解析工作表: {}", sheet_name);

            match self
                .parse_excel_worksheet(&mut workbook, sheet_name, &mut stats)
                .await
            {
                Ok(mut records) => {
                    debug!(
                        "工作表 '{}' 解析完成，获得 {} 条记录",
                        sheet_name,
                        records.len()
                    );
                    all_records.append(&mut records);

                    // 检查最大行数限制
                    if self.config.max_rows > 0 && all_records.len() >= self.config.max_rows {
                        info!("达到最大解析行数限制: {}", self.config.max_rows);
                        all_records.truncate(self.config.max_rows);
                        break;
                    }
                }
                Err(e) => {
                    warn!("解析工作表 '{}' 时出错: {}", sheet_name, e);
                    if self.config.strict_mode {
                        return Err(anyhow!("严格模式下工作表解析失败: {}", e));
                    }
                    // 非严格模式下继续处理下一个工作表
                    continue;
                }
            }
        }

        // 更新统计信息
        stats.parsed_rows = all_records.len();

        info!(
            "Excel解析完成: 处理 {} 个工作表，总行数={}, 成功解析={}, 跳过={}",
            sheet_names.len(),
            stats.total_rows,
            stats.parsed_rows,
            stats.skipped_rows
        );

        Ok((all_records, stats))
    }

    /// 解析单个Excel工作表
    async fn parse_excel_worksheet<RS: Read + Seek>(
        &self,
        workbook: &mut Sheets<RS>,
        sheet_name: &str,
        stats: &mut ParseStats,
    ) -> Result<Vec<VideoRecord>> {
        // 获取工作表范围
        let range = workbook
            .worksheet_range(sheet_name)
            .ok_or_else(|| anyhow!("工作表 '{}' 不存在", sheet_name))?
            .map_err(|e| anyhow!("读取工作表 '{}' 时出错: {}", sheet_name, e))?;

        if range.is_empty() {
            debug!("工作表 '{}' 为空", sheet_name);
            return Ok(Vec::new());
        }

        let (total_rows, total_cols) = range.get_size();
        debug!(
            "工作表 '{}' 大小: {} 行 × {} 列",
            sheet_name, total_rows, total_cols
        );

        let mut rows_iter = range.rows();

        // 读取表头（假设第一行是表头）
        let header_row = match rows_iter.next() {
            Some(header) => header,
            None => {
                debug!("工作表 '{}' 没有数据行", sheet_name);
                return Ok(Vec::new());
            }
        };

        // 构建字段映射
        let field_mapping = self.build_excel_field_mapping(header_row)?;
        debug!("Excel字段映射: {:?}", field_mapping);

        let mut records = Vec::new();
        let mut row_number = 1; // 表头是第1行，数据从第2行开始

        // 遍历数据行
        for data_row in rows_iter {
            row_number += 1;
            stats.total_rows += 1;

            if self.config.skip_empty_rows && self.is_empty_excel_row(data_row) {
                stats.skipped_rows += 1;
                continue;
            }

            match self.parse_excel_record(data_row, &field_mapping, row_number, sheet_name) {
                Ok(video_record) => {
                    records.push(video_record);
                }
                Err(e) => {
                    warn!(
                        "跳过工作表 '{}' 第{}行，解析错误: {}",
                        sheet_name, row_number, e
                    );
                    stats.skipped_rows += 1;

                    if self.config.strict_mode {
                        return Err(anyhow!(
                            "严格模式下解析失败在工作表 '{}' 第{}行: {}",
                            sheet_name,
                            row_number,
                            e
                        ));
                    }
                }
            }

            // 检查最大行数限制（单个工作表）
            if self.config.max_rows > 0 && records.len() >= self.config.max_rows {
                info!(
                    "工作表 '{}' 达到最大解析行数限制: {}",
                    sheet_name, self.config.max_rows
                );
                break;
            }
        }

        Ok(records)
    }

    /// 构建Excel字段映射
    fn build_excel_field_mapping(&self, header_row: &[DataType]) -> Result<HashMap<String, usize>> {
        let mut field_mapping = HashMap::new();

        for (index, cell) in header_row.iter().enumerate() {
            let header_str = match cell {
                DataType::String(s) => s.trim(),
                DataType::Int(i) => &i.to_string(),
                DataType::Float(f) => &f.to_string(),
                _ => continue, // 跳过其他类型的表头
            };

            if header_str.is_empty() {
                continue;
            }

            let normalized_header = header_str.to_lowercase();

            // 检查是否匹配专栏ID
            if self
                .config
                .field_mapping
                .column_id_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("column_id".to_string(), index);
            }
            // 检查是否匹配专栏名称
            else if self
                .config
                .field_mapping
                .column_name_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("column_name".to_string(), index);
            }
            // 检查是否匹配课程ID
            else if self
                .config
                .field_mapping
                .course_id_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("course_id".to_string(), index);
            }
            // 检查是否匹配课程名称
            else if self
                .config
                .field_mapping
                .course_name_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("course_name".to_string(), index);
            }
            // 检查是否匹配视频链接
            else if self
                .config
                .field_mapping
                .video_url_names
                .iter()
                .any(|name| name.to_lowercase() == normalized_header)
            {
                field_mapping.insert("video_url".to_string(), index);
            }
        }

        // 验证必需字段是否存在
        if self.config.strict_mode {
            let required_fields = ["video_url"]; // 至少需要视频链接
            for field in &required_fields {
                if !field_mapping.contains_key(*field) {
                    return Err(anyhow!("Excel表头中未找到必需字段: {}", field));
                }
            }
        }

        Ok(field_mapping)
    }

    /// 检查Excel行是否为空
    fn is_empty_excel_row(&self, row: &[DataType]) -> bool {
        row.iter().all(|cell| match cell {
            DataType::Empty => true,
            DataType::String(s) => s.trim().is_empty(),
            _ => false,
        })
    }

    /// 解析单个Excel记录
    fn parse_excel_record(
        &self,
        row: &[DataType],
        field_mapping: &HashMap<String, usize>,
        row_number: usize,
        sheet_name: &str,
    ) -> Result<VideoRecord> {
        let get_field = |field_name: &str| -> String {
            field_mapping
                .get(field_name)
                .and_then(|&index| row.get(index))
                .map(|cell| self.datatype_to_string(cell))
                .unwrap_or_default()
                .trim()
                .to_string()
        };

        let column_id = get_field("column_id");
        let column_name = get_field("column_name");
        let course_id = get_field("course_id");
        let course_name = get_field("course_name");
        let video_url = get_field("video_url");

        // 验证必需字段
        if video_url.is_empty() {
            return Err(anyhow!("视频链接不能为空"));
        }

        // 验证URL格式
        if !self.is_valid_url(&video_url) {
            return Err(anyhow!("无效的视频链接格式: {}", video_url));
        }

        // 如果专栏名称为空，尝试使用工作表名称
        let final_column_name = if column_name.is_empty() && !self.config.strict_mode {
            sheet_name.to_string()
        } else {
            column_name
        };

        Ok(VideoRecord {
            column_id,
            column_name: final_column_name,
            course_id,
            course_name,
            video_url,
            source_row: row_number,
        })
    }

    /// 将DataType转换为字符串
    fn datatype_to_string(&self, data: &DataType) -> String {
        match data {
            DataType::Empty => String::new(),
            DataType::String(s) => s.clone(),
            DataType::Int(i) => i.to_string(),
            DataType::Float(f) => {
                // 处理浮点数，去除不必要的小数点
                if f.fract() == 0.0 {
                    format!("{:.0}", f)
                } else {
                    f.to_string()
                }
            }
            DataType::Bool(b) => b.to_string(),
            DataType::DateTime(dt) => dt.to_string(),
            DataType::Error(err) => format!("ERROR: {:?}", err),
            DataType::DurationIso(d) => d.to_string(),
            DataType::DateTimeIso(dt) => dt.to_string(),
            DataType::Duration(d) => format!("{}", d),
        }
    }
}

impl Default for FileParser {
    fn default() -> Self {
        Self::new()
    }
}

// 便利函数
impl FileParser {
    /// 快速解析文件（使用默认配置）
    pub async fn parse<P: AsRef<Path>>(file_path: P) -> Result<(Vec<VideoRecord>, ParseStats)> {
        let parser = FileParser::new();
        parser.parse_file(file_path).await
    }
}
