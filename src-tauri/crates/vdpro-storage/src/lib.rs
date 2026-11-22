//! Persistent SQLite WAL task storage and atomic `.part` file staging for Video Downloader Pro.

pub mod part_file;
pub mod sqlite_store;

pub use part_file::{derive_part_path, PartFileChunkWriter, PartFileWriter};
pub use sqlite_store::{resolve_storage_paths, SqliteStateStore};
