//! 文件解析器测试模块
//!
//! 测试编码检测、CSV解析和Excel解析功能

#[cfg(test)]
#[allow(unused_imports)]
mod tests {
    use crate::core::file_parser::*;
    use anyhow::Result;
    use calamine::DataType;
    use encoding_rs::{Encoding, BIG5, GB18030, GBK, SHIFT_JIS, UTF_8};
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use tempfile::{tempdir, NamedTempFile};

    /// 创建测试文件的辅助函数
    fn create_test_file_with_encoding(
        content: &str,
        encoding: &'static Encoding,
    ) -> Result<NamedTempFile> {
        let mut file = NamedTempFile::new()?;

        // 根据编码转换内容
        let (encoded_bytes, _, _) = encoding.encode(content);
        file.write_all(&encoded_bytes)?;
        file.flush()?;

        Ok(file)
    }

    /// 创建带BOM的UTF-8文件
    fn create_utf8_bom_file(content: &str) -> Result<NamedTempFile> {
        let mut file = NamedTempFile::new()?;

        // 写入UTF-8 BOM
        file.write_all(&[0xEF, 0xBB, 0xBF])?;
        file.write_all(content.as_bytes())?;
        file.flush()?;

        Ok(file)
    }

    #[test]
    fn test_utf8_bom_detection() {
        let detector = EncodingDetector::new();
        let content = "Hello, 世界! This is a test file.";

        let file = create_utf8_bom_file(content).unwrap();
        let detected = detector.detect_encoding(file.path()).unwrap();

        assert_eq!(detected, UTF_8);
    }

    #[test]
    fn test_utf8_without_bom_detection() {
        let detector = EncodingDetector::new();
        let content = "Hello, 世界! 这是一个测试文件。";

        let file = create_test_file_with_encoding(content, UTF_8).unwrap();
        let detected = detector.detect_encoding(file.path()).unwrap();

        assert_eq!(detected, UTF_8);
    }

    #[test]
    fn test_gbk_detection() {
        let detector = EncodingDetector::new();
        let content = "你好世界！这是一个GBK编码的测试文件。包含中文字符。";

        let file = create_test_file_with_encoding(content, GBK).unwrap();
        let detected = detector.detect_encoding(file.path()).unwrap();

        // 应该检测到GBK或GB18030（GB18030包含GBK）
        assert!(detected == GBK || detected == GB18030);
    }

    #[test]
    fn test_encoding_conversion() {
        let detector = EncodingDetector::new();
        let original_content = "测试内容，包含中文字符：你好世界！";

        // 创建GBK编码的文件
        let file = create_test_file_with_encoding(original_content, GBK).unwrap();

        // 检测并创建转换读取器
        let (mut reader, detected_encoding) =
            detector.detect_and_create_reader(file.path()).unwrap();

        // 读取转换后的内容
        let mut converted_content = String::new();
        reader.read_to_string(&mut converted_content).unwrap();

        // 验证内容正确转换
        assert_eq!(converted_content.trim(), original_content);
        assert!(detected_encoding == GBK || detected_encoding == GB18030);
    }

    #[test]
    fn test_ascii_file_detection() {
        let detector = EncodingDetector::new();
        let content = "column_id,column_name,course_id,course_name,video_url\n1,Test,101,Course1,http://example.com/video1.mp4\n";

        let file = create_test_file_with_encoding(content, UTF_8).unwrap();
        let detected = detector.detect_encoding(file.path()).unwrap();

        assert_eq!(detected, UTF_8);
    }

    #[test]
    fn test_mixed_content_detection() {
        let detector = EncodingDetector::new();
        let content = "zl_id,zl_name,kc_id,kc_name,record_url\n1,编程基础,101,第一课：Hello World,http://example.com/1.mp4\n2,算法入门,102,第二课：排序算法,http://example.com/2.mp4\n";

        let file = create_test_file_with_encoding(content, UTF_8).unwrap();
        let detected = detector.detect_encoding(file.path()).unwrap();

        assert_eq!(detected, UTF_8);
    }

    #[test]
    fn test_empty_file_detection() {
        let detector = EncodingDetector::new();
        let file = NamedTempFile::new().unwrap();

        let detected = detector.detect_encoding(file.path()).unwrap();
        assert_eq!(detected, UTF_8); // 空文件应该默认为UTF-8
    }

    #[test]
    fn test_encoding_detector_configuration() {
        let detector = EncodingDetector::new()
            .with_buffer_size(4096)
            .with_deep_detection(true)
            .with_priority_encodings(vec![UTF_8, GBK, BIG5]);

        // 测试配置是否生效
        assert_eq!(detector.buffer_size_for_tests(), 4096);
        assert_eq!(detector.deep_detection_for_tests(), true);
        assert_eq!(detector.priority_encodings_for_tests().len(), 3);
    }

    #[test]
    fn test_reasonable_text_validation() {
        let detector = EncodingDetector::new();

        // 正常文本
        assert!(detector.test_is_reasonable_text("Hello, 世界! 测试内容。"));

        // 过多控制字符的文本
        let control_heavy = "\x01\x02\x03\x04\x05Hello\x06\x07\x08\x09\x0A";
        assert!(!detector.test_is_reasonable_text(control_heavy));

        // 空文本
        assert!(!detector.test_is_reasonable_text(""));

        // 纯ASCII
        assert!(detector.test_is_reasonable_text("Hello World"));

        // 纯中文
        assert!(detector.test_is_reasonable_text("你好世界"));
    }

    #[test]
    fn test_statistical_chinese_detection() {
        let detector = EncodingDetector::new();

        // 模拟GBK字节序列
        let gbk_bytes = &[0xC4, 0xE3, 0xBA, 0xC3]; // "你好" in GBK
        let detected = detector.test_statistical_chinese_detect(gbk_bytes);

        // 应该能检测出中文编码
        assert!(detected == GBK || detected == GB18030 || detected == BIG5);
    }

    #[test]
    fn test_bom_detection() {
        let detector = EncodingDetector::new();

        // UTF-8 BOM
        let utf8_bom = &[0xEF, 0xBB, 0xBF, b'H', b'e', b'l', b'l', b'o'];
        assert_eq!(detector.test_detect_bom(utf8_bom), Some(UTF_8));

        // UTF-16 LE BOM
        let utf16le_bom = &[0xFF, 0xFE, b'H', 0x00, b'e', 0x00];
        assert_eq!(
            detector.test_detect_bom(utf16le_bom),
            Some(encoding_rs::UTF_16LE)
        );

        // UTF-16 BE BOM
        let utf16be_bom = &[0xFE, 0xFF, 0x00, b'H', 0x00, b'e'];
        assert_eq!(
            detector.test_detect_bom(utf16be_bom),
            Some(encoding_rs::UTF_16BE)
        );

        // 无BOM
        let no_bom = &[b'H', b'e', b'l', b'l', b'o'];
        assert_eq!(detector.test_detect_bom(no_bom), None);
    }

    #[test]
    fn test_encoding_ranges() {
        let detector = EncodingDetector::new();

        // 测试GBK范围检测
        assert!(detector.test_is_gbk_range(0x81, 0x40)); // GBK范围内
        assert!(detector.test_is_gbk_range(0xFE, 0xFE)); // GBK范围内
        assert!(!detector.test_is_gbk_range(0x80, 0x40)); // 超出范围
        assert!(!detector.test_is_gbk_range(0x81, 0x7F)); // 第二字节无效

        // 测试Big5范围检测
        assert!(detector.test_is_big5_range(0xA1, 0xA1)); // Big5范围内
        assert!(!detector.test_is_big5_range(0x80, 0x40)); // 超出范围

        // 测试Shift-JIS范围检测
        assert!(detector.test_is_shift_jis_range(0x81, 0x40)); // Shift-JIS范围内
        assert!(detector.test_is_shift_jis_range(0xE0, 0x80)); // Shift-JIS范围内
        assert!(!detector.test_is_shift_jis_range(0x80, 0x40)); // 超出范围
    }
}

#[cfg(test)]
#[allow(unused_imports)]
mod integration_tests {
    use crate::core::file_parser::*;
    use anyhow::Result;
    use calamine::DataType;
    use encoding_rs::{GB18030, GBK, UTF_8};
    use std::collections::HashMap;
    use std::{fs, io::Read};
    use tempfile::tempdir;

    /// 创建测试CSV文件
    fn create_test_csv_files() -> Result<tempfile::TempDir> {
        let temp_dir = tempdir()?;

        // UTF-8编码的CSV
        let utf8_csv_content = "zl_id,zl_name,kc_id,kc_name,record_url\n1,编程基础,101,Hello World,http://example.com/1.mp4\n2,数据结构,102,链表结构,http://example.com/2.mp4\n";
        fs::write(temp_dir.path().join("utf8_test.csv"), utf8_csv_content)?;

        // GBK编码的CSV
        let gbk_csv_content = "zl_id,zl_name,kc_id,kc_name,record_url\n1,编程基础,101,第一课,http://example.com/1.mp4\n";
        let (gbk_bytes, _, _) = GBK.encode(gbk_csv_content);
        fs::write(temp_dir.path().join("gbk_test.csv"), &*gbk_bytes)?;

        // 带BOM的UTF-8 CSV
        let mut utf8_bom_content = vec![0xEF, 0xBB, 0xBF]; // UTF-8 BOM
        utf8_bom_content.extend_from_slice(utf8_csv_content.as_bytes());
        fs::write(temp_dir.path().join("utf8_bom_test.csv"), utf8_bom_content)?;

        Ok(temp_dir)
    }

    #[tokio::test]
    async fn test_file_format_detection() {
        let parser = FileParser::new();
        let temp_dir = create_test_csv_files().unwrap();

        // 测试CSV格式检测
        let csv_format = parser.test_detect_file_format(temp_dir.path().join("utf8_test.csv"))
            .unwrap();
        assert_eq!(csv_format, FileFormat::Csv);

        // 测试未知扩展名（应该默认为CSV）
        fs::write(temp_dir.path().join("unknown.txt"), "test").unwrap();
        let unknown_format = parser.test_detect_file_format(temp_dir.path().join("unknown.txt"))
            .unwrap();
        assert_eq!(unknown_format, FileFormat::Csv);
    }

    #[tokio::test]
    async fn test_encoding_detection_integration() {
        let temp_dir = create_test_csv_files().unwrap();
        let detector = EncodingDetector::new();

        // UTF-8文件
        let utf8_encoding = detector
            .detect_encoding(temp_dir.path().join("utf8_test.csv"))
            .unwrap();
        assert_eq!(utf8_encoding, UTF_8);

        // GBK文件
        let gbk_encoding = detector
            .detect_encoding(temp_dir.path().join("gbk_test.csv"))
            .unwrap();
        assert!(gbk_encoding == GBK || gbk_encoding == GB18030);

        // UTF-8 BOM文件
        let utf8_bom_encoding = detector
            .detect_encoding(temp_dir.path().join("utf8_bom_test.csv"))
            .unwrap();
        assert_eq!(utf8_bom_encoding, UTF_8);
    }

    #[tokio::test]
    async fn test_encoding_conversion_integration() {
        let temp_dir = create_test_csv_files().unwrap();
        let detector = EncodingDetector::new();

        // 测试GBK文件的编码转换
        let (mut reader, encoding) = detector
            .detect_and_create_reader(temp_dir.path().join("gbk_test.csv"))
            .unwrap();

        let mut content = String::new();
        reader.read_to_string(&mut content).unwrap();

        // 应该能正确读取中文内容
        assert!(content.contains("编程基础"));
        assert!(content.contains("第一课"));
        assert!(encoding == GBK || encoding == GB18030);
    }

    #[tokio::test]
    async fn test_csv_parser_basic() {
        let temp_dir = tempdir().unwrap();

        // 创建基本的CSV测试文件
        let csv_content = "zl_id,zl_name,kc_id,kc_name,record_url
1,编程基础,101,Hello World,https://example.com/1.mp4
2,数据结构,102,链表原理,https://example.com/2.mp4
3,算法设计,103,排序算法,https://example.com/3.mp4";

        let csv_path = temp_dir.path().join("test.csv");
        fs::write(&csv_path, csv_content).unwrap();

        let parser = FileParser::new();
        let (records, stats) = parser.parse_file(&csv_path).await.unwrap();

        // 验证解析结果
        assert_eq!(records.len(), 3);
        assert_eq!(stats.parsed_rows, 3);
        assert_eq!(stats.total_rows, 3);
        assert_eq!(stats.skipped_rows, 0);
        assert_eq!(stats.file_format, FileFormat::Csv);

        // 验证第一条记录
        let first_record = &records[0];
        assert_eq!(first_record.column_id, "1");
        assert_eq!(first_record.column_name, "编程基础");
        assert_eq!(first_record.course_id, "101");
        assert_eq!(first_record.course_name, "Hello World");
        assert_eq!(first_record.video_url, "https://example.com/1.mp4");
        assert_eq!(first_record.source_row, 2); // 第2行（表头是第1行）
    }

    #[tokio::test]
    async fn test_csv_parser_different_delimiters() {
        let temp_dir = tempdir().unwrap();

        // 测试分号分隔符
        let csv_content_semicolon = "zl_id;zl_name;record_url
1;编程基础;https://example.com/1.mp4
2;数据结构;https://example.com/2.mp4";

        let csv_path = temp_dir.path().join("semicolon.csv");
        fs::write(&csv_path, csv_content_semicolon).unwrap();

        let parser = FileParser::new();
        let (records, _) = parser.parse_file(&csv_path).await.unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].column_id, "1");
        assert_eq!(records[0].column_name, "编程基础");

        // 测试制表符分隔符
        let csv_content_tab = "zl_id\tzl_name\trecord_url
1\t编程基础\thttps://example.com/1.mp4";

        let csv_path_tab = temp_dir.path().join("tab.csv");
        fs::write(&csv_path_tab, csv_content_tab).unwrap();

        let (records_tab, _) = parser.parse_file(&csv_path_tab).await.unwrap();
        assert_eq!(records_tab.len(), 1);
        assert_eq!(records_tab[0].column_name, "编程基础");
    }

    #[tokio::test]
    async fn test_csv_parser_field_mapping() {
        let temp_dir = tempdir().unwrap();

        // 测试不同的列名变体
        let csv_content = "Column ID,Column Name,Course ID,Course Name,Video URL
1,编程基础,101,Hello World,https://example.com/1.mp4
2,数据结构,102,链表原理,https://example.com/2.mp4";

        let csv_path = temp_dir.path().join("mapping_test.csv");
        fs::write(&csv_path, csv_content).unwrap();

        let parser = FileParser::new();
        let (records, stats) = parser.parse_file(&csv_path).await.unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(stats.parsed_rows, 2);

        // 验证字段映射工作正常
        assert_eq!(records[0].column_id, "1");
        assert_eq!(records[0].column_name, "编程基础");
        assert_eq!(records[0].course_id, "101");
        assert_eq!(records[0].course_name, "Hello World");
        assert_eq!(records[0].video_url, "https://example.com/1.mp4");
    }

    #[tokio::test]
    async fn test_csv_parser_error_handling() {
        let temp_dir = tempdir().unwrap();

        // 创建包含错误行的CSV
        let csv_content = "zl_id,zl_name,record_url
1,编程基础,https://example.com/1.mp4
2,数据结构,invalid-url
3,算法设计,https://example.com/3.mp4
4,空链接,
5,,";

        let csv_path = temp_dir.path().join("error_test.csv");
        fs::write(&csv_path, csv_content).unwrap();

        let parser = FileParser::new(); // 非严格模式
        let (records, stats) = parser.parse_file(&csv_path).await.unwrap();

        // 应该只解析成功的记录
        assert_eq!(records.len(), 1); // 只有第一行成功
        assert_eq!(stats.parsed_rows, 1);
        assert!(stats.skipped_rows > 0); // 跳过了一些行
        assert_eq!(records[0].column_id, "1");
        assert_eq!(records[0].column_name, "编程基础");
    }

    #[tokio::test]
    async fn test_csv_parser_strict_mode() {
        let temp_dir = tempdir().unwrap();

        // 创建包含错误的CSV
        let csv_content = "zl_id,zl_name,record_url
1,编程基础,https://example.com/1.mp4
2,数据结构,invalid-url";

        let csv_path = temp_dir.path().join("strict_test.csv");
        fs::write(&csv_path, csv_content).unwrap();

        let config = FileParserConfig {
            strict_mode: true,
            ..Default::default()
        };
        let parser = FileParser::with_config(config);

        // 严格模式下应该失败
        let result = parser.parse_file(&csv_path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_csv_parser_max_rows() {
        let temp_dir = tempdir().unwrap();

        let csv_content = "zl_id,zl_name,record_url
1,编程基础,https://example.com/1.mp4
2,数据结构,https://example.com/2.mp4
3,算法设计,https://example.com/3.mp4
4,系统设计,https://example.com/4.mp4
5,架构设计,https://example.com/5.mp4";

        let csv_path = temp_dir.path().join("max_rows_test.csv");
        fs::write(&csv_path, csv_content).unwrap();

        let config = FileParserConfig {
            max_rows: 3,
            ..Default::default()
        };
        let parser = FileParser::with_config(config);
        let (records, stats) = parser.parse_file(&csv_path).await.unwrap();

        // 应该只解析前3行
        assert_eq!(records.len(), 3);
        assert_eq!(stats.parsed_rows, 3);
    }

    #[tokio::test]
    async fn test_csv_parser_encoding_gbk() {
        let temp_dir = tempdir().unwrap();

        // 创建GBK编码的CSV文件
        let csv_content = "zl_id,zl_name,kc_name,record_url
1,编程基础入门,第一课：变量和类型,https://example.com/1.mp4
2,数据结构详解,第二课：链表实现,https://example.com/2.mp4";

        let (gbk_bytes, _, _) = GBK.encode(csv_content);
        let csv_path = temp_dir.path().join("gbk_test.csv");
        fs::write(&csv_path, &*gbk_bytes).unwrap();

        let parser = FileParser::new();
        let (records, stats) = parser.parse_file(&csv_path).await.unwrap();

        // 验证中文内容正确解析
        assert_eq!(records.len(), 2);
        assert!(stats.detected_encoding == "GBK" || stats.detected_encoding == "GB18030");
        assert_eq!(records[0].column_name, "编程基础入门");
        assert_eq!(records[0].course_name, "第一课：变量和类型");
        assert_eq!(records[1].column_name, "数据结构详解");
        assert_eq!(records[1].course_name, "第二课：链表实现");
    }

    #[tokio::test]
    async fn test_csv_parser_empty_rows() {
        let temp_dir = tempdir().unwrap();

        let csv_content = "zl_id,zl_name,record_url
1,编程基础,https://example.com/1.mp4

2,数据结构,https://example.com/2.mp4
,,
3,算法设计,https://example.com/3.mp4";

        let csv_path = temp_dir.path().join("empty_rows_test.csv");
        fs::write(&csv_path, csv_content).unwrap();

        let parser = FileParser::new();
        let (records, stats) = parser.parse_file(&csv_path).await.unwrap();

        // 应该跳过空行
        assert_eq!(records.len(), 3);
        assert_eq!(stats.parsed_rows, 3);
        assert_eq!(stats.skipped_rows, 2); // 两个空行
    }

    #[tokio::test]
    async fn test_excel_parser_basic() {
        let temp_dir = tempdir().unwrap();
        let xlsx_path = temp_dir.path().join("test.xlsx");

        // 创建一个简单的Excel文件用于测试
        // 注意：在实际测试中，我们会创建一个手工的Excel文件
        // 这里我们跳过实际的Excel文件创建，因为calamine主要用于读取

        // 创建测试用的Excel数据（模拟）
        let test_data = vec![
            vec!["zl_id", "zl_name", "kc_id", "kc_name", "record_url"],
            vec![
                "1",
                "编程基础",
                "101",
                "Hello World",
                "https://example.com/1.mp4",
            ],
            vec![
                "2",
                "数据结构",
                "102",
                "链表原理",
                "https://example.com/2.mp4",
            ],
            vec![
                "3",
                "算法设计",
                "103",
                "排序算法",
                "https://example.com/3.mp4",
            ],
        ];

        // 由于我们无法直接创建Excel文件用于测试，
        // 这个测试验证Excel解析器的结构是否正确
        let parser = FileParser::new();

        // 验证DataType转换功能
        assert_eq!(
            parser.datatype_to_string(&DataType::String("test".to_string())),
            "test"
        );
        assert_eq!(parser.datatype_to_string(&DataType::Int(42)), "42");
        assert_eq!(parser.datatype_to_string(&DataType::Float(3.14)), "3.14");
        assert_eq!(parser.datatype_to_string(&DataType::Float(42.0)), "42");
        assert_eq!(parser.datatype_to_string(&DataType::Bool(true)), "true");
        assert_eq!(parser.datatype_to_string(&DataType::Empty), "");
    }

    #[test]
    fn test_excel_field_mapping() {
        let parser = FileParser::new();

        // 测试Excel字段映射
        let header_row = vec![
            DataType::String("zl_id".to_string()),
            DataType::String("专栏名称".to_string()),
            DataType::String("Course ID".to_string()),
            DataType::String("课程名".to_string()),
            DataType::String("Video URL".to_string()),
        ];

        let field_mapping = parser.build_excel_field_mapping(&header_row).unwrap();

        assert_eq!(field_mapping.get("column_id"), Some(&0));
        assert_eq!(field_mapping.get("column_name"), Some(&1));
        assert_eq!(field_mapping.get("course_id"), Some(&2));
        assert_eq!(field_mapping.get("course_name"), Some(&3));
        assert_eq!(field_mapping.get("video_url"), Some(&4));
    }

    #[test]
    fn test_excel_empty_row_detection() {
        let parser = FileParser::new();

        // 测试空行检测
        let empty_row = vec![
            DataType::Empty,
            DataType::String("".to_string()),
            DataType::Empty,
        ];
        assert!(parser.is_empty_excel_row(&empty_row));

        let non_empty_row = vec![
            DataType::Empty,
            DataType::String("test".to_string()),
            DataType::Empty,
        ];
        assert!(!parser.is_empty_excel_row(&non_empty_row));

        let mixed_row = vec![
            DataType::Int(42),
            DataType::Empty,
            DataType::String("data".to_string()),
        ];
        assert!(!parser.is_empty_excel_row(&mixed_row));
    }

    #[test]
    fn test_excel_record_parsing() {
        let parser = FileParser::new();
        let mut field_mapping = HashMap::new();
        field_mapping.insert("column_id".to_string(), 0);
        field_mapping.insert("column_name".to_string(), 1);
        field_mapping.insert("course_id".to_string(), 2);
        field_mapping.insert("course_name".to_string(), 3);
        field_mapping.insert("video_url".to_string(), 4);

        // 测试正常记录解析
        let row = vec![
            DataType::String("1".to_string()),
            DataType::String("编程基础".to_string()),
            DataType::Int(101),
            DataType::String("Hello World".to_string()),
            DataType::String("https://example.com/1.mp4".to_string()),
        ];

        let record = parser
            .parse_excel_record(&row, &field_mapping, 2, "Sheet1")
            .unwrap();
        assert_eq!(record.column_id, "1");
        assert_eq!(record.column_name, "编程基础");
        assert_eq!(record.course_id, "101");
        assert_eq!(record.course_name, "Hello World");
        assert_eq!(record.video_url, "https://example.com/1.mp4");
        assert_eq!(record.source_row, 2);

        // 测试缺少专栏名称时使用工作表名称
        let row_no_column_name = vec![
            DataType::String("2".to_string()),
            DataType::Empty,
            DataType::Int(102),
            DataType::String("Test Course".to_string()),
            DataType::String("https://example.com/2.mp4".to_string()),
        ];

        let record2 = parser
            .parse_excel_record(&row_no_column_name, &field_mapping, 3, "数据结构")
            .unwrap();
        assert_eq!(record2.column_name, "数据结构"); // 应该使用工作表名称
    }

    #[test]
    fn test_excel_record_parsing_errors() {
        let parser = FileParser::new();
        let mut field_mapping = HashMap::new();
        field_mapping.insert("video_url".to_string(), 0);

        // 测试空URL
        let row_empty_url = vec![DataType::Empty];
        let result = parser.parse_excel_record(&row_empty_url, &field_mapping, 2, "Sheet1");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("视频链接不能为空"));

        // 测试无效URL
        let row_invalid_url = vec![DataType::String("invalid-url".to_string())];
        let result2 = parser.parse_excel_record(&row_invalid_url, &field_mapping, 2, "Sheet1");
        assert!(result2.is_err());
        assert!(result2
            .unwrap_err()
            .to_string()
            .contains("无效的视频链接格式"));
    }

    #[test]
    fn test_datatype_conversion_comprehensive() {
        let parser = FileParser::new();

        // 测试所有DataType类型的转换
        assert_eq!(parser.datatype_to_string(&DataType::Empty), "");
        assert_eq!(
            parser.datatype_to_string(&DataType::String("测试".to_string())),
            "测试"
        );
        assert_eq!(parser.datatype_to_string(&DataType::Int(42)), "42");
        assert_eq!(parser.datatype_to_string(&DataType::Int(-100)), "-100");
        assert_eq!(
            parser.datatype_to_string(&DataType::Float(3.14159)),
            "3.14159"
        );
        assert_eq!(parser.datatype_to_string(&DataType::Float(42.0)), "42"); // 整数浮点数
        assert_eq!(parser.datatype_to_string(&DataType::Float(-0.5)), "-0.5");
        assert_eq!(parser.datatype_to_string(&DataType::Bool(true)), "true");
        assert_eq!(parser.datatype_to_string(&DataType::Bool(false)), "false");

        // 测试错误类型
        let error_result =
            parser.datatype_to_string(&DataType::Error(calamine::CellErrorType::Div0));
        assert!(error_result.contains("ERROR"));
    }

    #[test]
    fn test_excel_field_mapping_edge_cases() {
        let parser = FileParser::new();

        // 测试空表头
        let empty_headers = vec![DataType::Empty, DataType::Empty];
        let mapping = parser.build_excel_field_mapping(&empty_headers).unwrap();
        assert!(mapping.is_empty());

        // 测试混合类型表头
        let mixed_headers = vec![
            DataType::String("zl_id".to_string()),
            DataType::Int(123),    // 数字表头
            DataType::Float(3.14), // 浮点数表头
            DataType::String("record_url".to_string()),
            DataType::Bool(true), // 布尔值表头（应该被跳过）
            DataType::Empty,      // 空表头（应该被跳过）
        ];

        let mapping = parser.build_excel_field_mapping(&mixed_headers).unwrap();
        assert_eq!(mapping.get("column_id"), Some(&0));
        assert_eq!(mapping.get("video_url"), Some(&3));
        // 数字和浮点数表头不会匹配字段映射
        assert!(!mapping.contains_key("123"));
        assert!(!mapping.contains_key("3.14"));
    }

    #[test]
    fn test_excel_field_mapping_strict_mode() {
        let mut config = FileParserConfig::default();
        config.strict_mode = true;
        let parser = FileParser::with_config(config);

        // 测试严格模式下缺少必需字段
        let incomplete_headers = vec![
            DataType::String("zl_id".to_string()),
            DataType::String("zl_name".to_string()),
            // 缺少video_url字段
        ];

        let result = parser.build_excel_field_mapping(&incomplete_headers);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("未找到必需字段: video_url"));
    }

    #[test]
    fn test_excel_parser_configuration() {
        // 测试解析器配置
        let mut config = FileParserConfig::default();
        config.max_rows = 100;
        config.strict_mode = true;
        config.skip_empty_rows = false;

        let parser = FileParser::with_config(config.clone());
        assert_eq!(parser.config.max_rows, 100);
        assert_eq!(parser.config.strict_mode, true);
        assert_eq!(parser.config.skip_empty_rows, false);
    }
}




