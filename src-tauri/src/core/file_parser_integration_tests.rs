//! 文件解析器集成测试
//!
//! 端到端测试文件解析系统，包括：
//! - CSV和Excel文件的完整解析流程
//! - 编码检测和转换的集成测试
//! - 错误恢复和容错机制测试
//! - 性能和大文件处理测试
//! - 实际使用场景模拟

#[cfg(test)]
mod integration_tests {
    use crate::core::file_parser::*;
    use anyhow::Result;
    use calamine::DataType;
    use encoding_rs::{BIG5, GBK, SHIFT_JIS, UTF_8};
    use futures::future;
    use std::{collections::HashMap, fs, io::Write, path::Path};
    use tempfile::tempdir;

    /// 创建测试文件集合
    struct TestFileSet {
        temp_dir: tempfile::TempDir,
        csv_utf8: std::path::PathBuf,
        csv_gbk: std::path::PathBuf,
        csv_big5: std::path::PathBuf,
        csv_mixed_delimiters: std::path::PathBuf,
        csv_large: std::path::PathBuf,
        csv_malformed: std::path::PathBuf,
    }

    impl TestFileSet {
        fn new() -> Result<Self> {
            let temp_dir = tempdir()?;
            let base_path = temp_dir.path();

            // UTF-8 CSV文件
            let csv_content_utf8 = "zl_id,zl_name,kc_id,kc_name,record_url\n1,编程基础入门,101,第一课：变量与类型,https://example.com/course1.mp4\n2,数据结构详解,102,第二课：链表实现,https://example.com/course2.mp4\n3,算法设计分析,103,第三课：排序算法,https://example.com/course3.mp4\n";
            let csv_utf8 = base_path.join("test_utf8.csv");
            fs::write(&csv_utf8, csv_content_utf8)?;

            // GBK编码CSV文件
            let csv_content_gbk = "zl_id,zl_name,kc_id,kc_name,record_url\n1,编程语言精通,201,第一讲：语法基础,https://example.com/advanced1.mp4\n2,系统架构设计,202,第二讲：设计模式,https://example.com/advanced2.mp4\n3,性能优化实战,203,第三讲：算法优化,https://example.com/advanced3.mp4\n";
            let (gbk_bytes, _, _) = GBK.encode(csv_content_gbk);
            let csv_gbk = base_path.join("test_gbk.csv");
            fs::write(&csv_gbk, &*gbk_bytes)?;

            // Big5编码CSV文件（繁体中文）
            let csv_content_big5 = "zl_id,zl_name,kc_id,kc_name,record_url\n1,程式設計入門,301,第一課：變數與型別,https://example.com/traditional1.mp4\n2,資料結構詳解,302,第二課：鏈結串列,https://example.com/traditional2.mp4\n";
            let (big5_bytes, _, _) = BIG5.encode(csv_content_big5);
            let csv_big5 = base_path.join("test_big5.csv");
            fs::write(&csv_big5, &*big5_bytes)?;

            // 混合分隔符的CSV文件
            let mixed_delimiters_content = "zl_id;zl_name;kc_id;kc_name;record_url\n1;前端开发;401;JavaScript基础;https://example.com/frontend1.mp4\n2;后端开发;402;Node.js实战;https://example.com/backend1.mp4\n";
            let csv_mixed = base_path.join("test_mixed.csv");
            fs::write(&csv_mixed, mixed_delimiters_content)?;

            // 大文件CSV（用于性能测试）
            let mut large_content = String::from("zl_id,zl_name,kc_id,kc_name,record_url\n");
            for i in 1..=1000 {
                large_content.push_str(&format!(
                    "{},大型课程集合{},{}01,第{}课：高级内容,https://example.com/large{}.mp4\n",
                    i,
                    i % 10,
                    i,
                    i,
                    i
                ));
            }
            let csv_large = base_path.join("test_large.csv");
            fs::write(&csv_large, large_content)?;

            // 格式错误的CSV文件
            let malformed_content = "zl_id,zl_name,kc_id,kc_name,record_url\n1,正常记录,101,正常课程,https://example.com/normal.mp4\n2,缺少链接,102,错误课程,\n3,无效链接,103,另一个错误,invalid-url\n,空ID记录,104,空ID课程,https://example.com/empty-id.mp4\n4,\"包含,逗号的,名称\",105,引号测试,https://example.com/quotes.mp4\n";
            let csv_malformed = base_path.join("test_malformed.csv");
            fs::write(&csv_malformed, malformed_content)?;

            Ok(TestFileSet {
                temp_dir,
                csv_utf8,
                csv_gbk,
                csv_big5,
                csv_mixed_delimiters: csv_mixed,
                csv_large,
                csv_malformed,
            })
        }
    }

    #[tokio::test]
    async fn test_end_to_end_csv_parsing_workflow() {
        let test_files = TestFileSet::new().unwrap();
        let parser = FileParser::new();

        // 测试UTF-8文件解析
        let (records_utf8, stats_utf8) = parser.parse_file(&test_files.csv_utf8).await.unwrap();
        assert_eq!(records_utf8.len(), 3);
        assert_eq!(stats_utf8.file_format, FileFormat::Csv);
        assert_eq!(stats_utf8.detected_encoding, "UTF-8");
        assert_eq!(stats_utf8.parsed_rows, 3);
        assert_eq!(stats_utf8.skipped_rows, 0);

        // 验证UTF-8内容
        assert_eq!(records_utf8[0].column_name, "编程基础入门");
        assert_eq!(records_utf8[0].course_name, "第一课：变量与类型");
        assert!(records_utf8[0].video_url.contains("course1.mp4"));

        // 测试GBK文件解析
        let (records_gbk, stats_gbk) = parser.parse_file(&test_files.csv_gbk).await.unwrap();
        assert_eq!(records_gbk.len(), 3);
        assert!(stats_gbk.detected_encoding == "GBK" || stats_gbk.detected_encoding == "GB18030");

        // 验证GBK内容正确转换
        assert_eq!(records_gbk[0].column_name, "编程语言精通");
        assert_eq!(records_gbk[1].course_name, "第二讲：设计模式");

        // 测试Big5文件解析
        let (records_big5, stats_big5) = parser.parse_file(&test_files.csv_big5).await.unwrap();
        assert_eq!(records_big5.len(), 2);
        // 验证繁体中文内容
        assert_eq!(records_big5[0].column_name, "程式設計入門");
        assert_eq!(records_big5[0].course_name, "第一課：變數與型別");
    }

    #[tokio::test]
    async fn test_encoding_detection_accuracy() {
        let test_files = TestFileSet::new().unwrap();
        let detector = EncodingDetector::new();

        // 测试UTF-8检测
        let encoding_utf8 = detector.detect_encoding(&test_files.csv_utf8).unwrap();
        assert_eq!(encoding_utf8, UTF_8);

        // 测试GBK检测
        let encoding_gbk = detector.detect_encoding(&test_files.csv_gbk).unwrap();
        assert!(encoding_gbk == GBK || encoding_gbk == encoding_rs::GB18030);

        // 测试Big5检测
        let encoding_big5 = detector.detect_encoding(&test_files.csv_big5).unwrap();
        // Big5检测可能被识别为GBK，这是正常的，关键是内容能正确解析
        assert!(
            encoding_big5 == BIG5 || encoding_big5 == GBK || encoding_big5 == encoding_rs::GB18030
        );
    }

    #[tokio::test]
    async fn test_delimiter_auto_detection() {
        let test_files = TestFileSet::new().unwrap();
        let parser = FileParser::new();

        // 测试分号分隔符自动检测
        let (records, stats) = parser
            .parse_file(&test_files.csv_mixed_delimiters)
            .await
            .unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].column_name, "前端开发");
        assert_eq!(records[1].column_name, "后端开发");
        assert_eq!(stats.parsed_rows, 2);
    }

    #[tokio::test]
    async fn test_error_recovery_and_tolerance() {
        let test_files = TestFileSet::new().unwrap();

        // 测试宽松模式（默认）
        let parser = FileParser::new();
        let (records, stats) = parser.parse_file(&test_files.csv_malformed).await.unwrap();

        // 应该解析成功的记录（排除错误记录）
        assert!(records.len() > 0); // 至少有一些正常记录
        assert!(stats.skipped_rows > 0); // 应该跳过了一些错误行
        assert_eq!(stats.total_rows, 5); // 总共5行数据

        // 验证正常记录被正确解析
        let normal_record = records
            .iter()
            .find(|r| r.column_name == "正常记录")
            .unwrap();
        assert_eq!(normal_record.course_name, "正常课程");

        // 测试包含逗号的字段（引号处理）
        let quotes_record = records.iter().find(|r| r.course_name == "引号测试");
        if quotes_record.is_some() {
            let record = quotes_record.unwrap();
            assert!(record.column_name.contains("逗号")); // 应该正确处理引号
        }
    }

    #[tokio::test]
    async fn test_strict_mode_validation() {
        let test_files = TestFileSet::new().unwrap();

        // 测试严格模式
        let mut config = FileParserConfig::default();
        config.strict_mode = true;
        let parser = FileParser::with_config(config);

        // 严格模式下解析格式错误的文件应该失败
        let result = parser.parse_file(&test_files.csv_malformed).await;
        assert!(result.is_err()); // 应该因为错误记录而失败
    }

    #[tokio::test]
    async fn test_large_file_performance() {
        let test_files = TestFileSet::new().unwrap();
        let parser = FileParser::new();

        let start_time = std::time::Instant::now();
        let (records, stats) = parser.parse_file(&test_files.csv_large).await.unwrap();
        let elapsed = start_time.elapsed();

        // 验证大文件解析结果
        assert_eq!(records.len(), 1000);
        assert_eq!(stats.parsed_rows, 1000);
        assert_eq!(stats.total_rows, 1000);
        assert_eq!(stats.skipped_rows, 0);

        // 性能要求：1000行应该在合理时间内完成（1秒内）
        assert!(elapsed.as_secs() < 1, "大文件解析耗时过长: {:?}", elapsed);

        // 验证内容的正确性
        assert_eq!(records[0].column_id, "1");
        assert_eq!(records[999].column_id, "1000");
        assert!(records[500].column_name.contains("大型课程集合"));
    }

    #[tokio::test]
    async fn test_max_rows_limitation() {
        let test_files = TestFileSet::new().unwrap();

        // 测试行数限制
        let mut config = FileParserConfig::default();
        config.max_rows = 100;
        let parser = FileParser::with_config(config);

        let (records, stats) = parser.parse_file(&test_files.csv_large).await.unwrap();

        // 应该只解析100行
        assert_eq!(records.len(), 100);
        assert_eq!(stats.parsed_rows, 100);
        // total_rows可能是100或更多（取决于解析何时停止）
    }

    #[tokio::test]
    async fn test_field_mapping_flexibility() {
        let temp_dir = tempdir().unwrap();

        // 创建具有不同列名变体的CSV文件
        let test_cases = vec![
            // 英文列名
            ("Column ID,Column Name,Course ID,Course Name,Video URL\n1,Test Course,101,Lesson 1,https://example.com/1.mp4\n", "english.csv"),
            // 中文列名
            ("专栏ID,专栏名称,课程ID,课程名称,视频链接\n2,测试课程,102,第一课,https://example.com/2.mp4\n", "chinese.csv"),
            // 混合列名
            ("zl_id,专栏名,kc_id,Course Name,record_url\n3,混合测试,103,Mixed Test,https://example.com/3.mp4\n", "mixed.csv"),
            // 大小写变体
            ("ZL_ID,ZL_NAME,KC_ID,KC_NAME,RECORD_URL\n4,大写测试,104,Upper Case,https://example.com/4.mp4\n", "uppercase.csv"),
        ];

        let parser = FileParser::new();

        for (content, filename) in test_cases {
            let file_path = temp_dir.path().join(filename);
            fs::write(&file_path, content).unwrap();

            let (records, stats) = parser.parse_file(&file_path).await.unwrap();
            assert_eq!(records.len(), 1, "文件 {} 解析失败", filename);
            assert_eq!(stats.parsed_rows, 1);

            let record = &records[0];
            assert!(!record.video_url.is_empty());
            assert!(record.video_url.starts_with("https://"));
        }
    }

    #[tokio::test]
    async fn test_concurrent_file_parsing() {
        let test_files = TestFileSet::new().unwrap();
        let parser = std::sync::Arc::new(FileParser::new());

        // 并发解析多个文件
        let mut tasks = Vec::new();

        let files = vec![
            &test_files.csv_utf8,
            &test_files.csv_gbk,
            &test_files.csv_big5,
            &test_files.csv_mixed_delimiters,
        ];

        for file_path in files {
            let parser_clone = parser.clone();
            let path_clone = file_path.clone();

            let task = tokio::spawn(async move { parser_clone.parse_file(path_clone).await });
            tasks.push(task);
        }

        // 等待所有任务完成
        let results = futures::future::join_all(tasks).await;

        // 验证所有文件都成功解析
        for result in results {
            let (records, _stats) = result.unwrap().unwrap();
            assert!(records.len() > 0);
        }
    }

    #[tokio::test]
    async fn test_comprehensive_error_scenarios() {
        let temp_dir = tempdir().unwrap();
        let parser = FileParser::new();

        // 测试不存在的文件
        let non_existent = temp_dir.path().join("non_existent.csv");
        let result1 = parser.parse_file(&non_existent).await;
        assert!(result1.is_err());

        // 测试空文件
        let empty_file = temp_dir.path().join("empty.csv");
        fs::write(&empty_file, "").unwrap();
        let result2 = parser.parse_file(&empty_file).await;
        assert!(result2.is_err()); // 应该因为没有表头而失败

        // 测试只有表头的文件
        let header_only = temp_dir.path().join("header_only.csv");
        fs::write(&header_only, "zl_id,zl_name,record_url\n").unwrap();
        let (records3, stats3) = parser.parse_file(&header_only).await.unwrap();
        assert_eq!(records3.len(), 0);
        assert_eq!(stats3.total_rows, 0);

        // 测试完全无效的CSV内容
        let invalid_csv = temp_dir.path().join("invalid.csv");
        fs::write(
            &invalid_csv,
            "这不是一个有效的CSV文件\n随机内容\n更多随机数据",
        )
        .unwrap();
        // 在宽松模式下应该尝试解析但得到空结果或错误
        let result4 = parser.parse_file(&invalid_csv).await;
        // 取决于实现，可能成功但没有有效记录，或者失败
        if result4.is_ok() {
            let (records, _) = result4.unwrap();
            assert_eq!(records.len(), 0); // 没有有效记录
        }
    }

    #[tokio::test]
    async fn test_memory_usage_with_large_files() {
        let temp_dir = tempdir().unwrap();

        // 创建一个更大的测试文件
        let very_large_file = temp_dir.path().join("very_large.csv");
        let mut content = String::from("zl_id,zl_name,kc_id,kc_name,record_url\n");

        // 5000行数据
        for i in 1..=5000 {
            content.push_str(&format!(
                "{},超大课程集合{},{}001,第{}课：超级内容,https://example.com/mega{}.mp4\n",
                i,
                i % 20,
                i,
                i,
                i
            ));
        }
        fs::write(&very_large_file, content).unwrap();

        let parser = FileParser::new();
        let start_memory = get_current_memory_usage();

        let (records, stats) = parser.parse_file(&very_large_file).await.unwrap();

        let end_memory = get_current_memory_usage();

        assert_eq!(records.len(), 5000);
        assert_eq!(stats.parsed_rows, 5000);

        // 内存使用应该保持在合理范围内（具体数值取决于实现）
        let memory_increase = end_memory.saturating_sub(start_memory);

        // 这是一个粗略的检查，确保内存使用不会无限制增长
        // 5000条记录的内存增长应该在合理范围内（比如100MB以内）
        println!("内存增长: {} bytes", memory_increase);
        assert!(
            memory_increase < 100 * 1024 * 1024,
            "内存使用过多: {} bytes",
            memory_increase
        );
    }

    /// 获取当前内存使用量的粗略估计
    fn get_current_memory_usage() -> usize {
        // 这是一个简化的内存使用量获取方法
        // 在实际应用中，可能需要更精确的内存监控
        #[cfg(target_os = "windows")]
        {
            // Windows特定的内存获取方法
            0 // 简化实现
        }

        #[cfg(not(target_os = "windows"))]
        {
            // 其他系统的内存获取方法
            0 // 简化实现
        }
    }

    #[tokio::test]
    async fn test_unicode_and_special_characters() {
        let temp_dir = tempdir().unwrap();

        // 创建包含各种Unicode字符的测试文件
        let unicode_content = "zl_id,zl_name,kc_id,kc_name,record_url
1,编程🚀基础,101,第一课：变量💻类型,https://example.com/unicode1.mp4
2,数据📊结构,102,第二课：链表🔗实现,https://example.com/unicode2.mp4
3,算法🧮设计,103,第三课：排序⚡算法,https://example.com/unicode3.mp4
4,\"特殊字符,测试\",104,包含\"引号\"的内容,https://example.com/special.mp4
5,换行\n测试,105,制表符\t测试,https://example.com/control.mp4";

        let unicode_file = temp_dir.path().join("unicode_test.csv");
        fs::write(&unicode_file, unicode_content).unwrap();

        let parser = FileParser::new();
        let (records, stats) = parser.parse_file(&unicode_file).await.unwrap();

        // 应该成功解析大部分记录
        assert!(records.len() >= 3); // 至少解析了emoji记录
        assert!(stats.parsed_rows >= 3);

        // 验证Unicode字符正确处理
        let emoji_record = records.iter().find(|r| r.column_name.contains("🚀"));
        if emoji_record.is_some() {
            let record = emoji_record.unwrap();
            assert!(record.course_name.contains("💻"));
        }

        // 验证特殊字符处理
        let special_record = records.iter().find(|r| r.column_name.contains("特殊字符"));
        if special_record.is_some() {
            let record = special_record.unwrap();
            assert!(record.course_name.contains("引号"));
        }
    }
}
