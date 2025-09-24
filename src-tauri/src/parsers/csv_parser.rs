//! CSV parsing utilities

use anyhow::Result;
use csv::Reader;
use serde::{Deserialize, Serialize};
use std::io::BufRead;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvRecord {
    pub fields: Vec<String>,
}

/// Parse CSV from a buffered reader
pub fn parse_csv_from_reader<R: BufRead>(reader: R) -> Result<Vec<CsvRecord>> {
    let mut csv_reader = Reader::from_reader(reader);
    let mut records = Vec::new();

    for result in csv_reader.records() {
        let record = result?;
        let fields: Vec<String> = record.iter().map(|s| s.to_string()).collect();
        records.push(CsvRecord { fields });
    }

    Ok(records)
}
