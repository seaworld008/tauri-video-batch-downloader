//! Excel parsing utilities

use anyhow::Result;
use calamine::{open_workbook_auto, DataType, Reader};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExcelRecord {
    pub row: usize,
    pub values: Vec<String>,
}

/// Parse Excel file
pub fn parse_excel_file<P: AsRef<Path>>(path: P) -> Result<Vec<ExcelRecord>> {
    let mut workbook = open_workbook_auto(path)?;
    let mut records = Vec::new();

    if let Some(Ok(range)) = workbook.worksheet_range_at(0) {
        for (row_idx, row) in range.rows().enumerate() {
            let values: Vec<String> = row.iter().map(|cell| datatype_to_string(cell)).collect();

            records.push(ExcelRecord {
                row: row_idx,
                values,
            });
        }
    }

    Ok(records)
}

fn datatype_to_string(data: &DataType) -> String {
    match data {
        DataType::Empty => String::new(),
        DataType::String(s) => s.clone(),
        DataType::Int(i) => i.to_string(),
        DataType::Float(f) => f.to_string(),
        DataType::Bool(b) => b.to_string(),
        DataType::DateTime(dt) => dt.to_string(),
        DataType::Error(err) => format!("ERROR: {:?}", err),
        DataType::DurationIso(d) => d.to_string(),
        DataType::DateTimeIso(dt) => dt.to_string(),
        DataType::Duration(d) => format!("{}", d),
    }
}
