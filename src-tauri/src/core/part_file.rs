use anyhow::Result;
use std::path::{Path, PathBuf};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};

#[derive(Debug, Clone)]
pub struct PartFileWriter {
    final_path: PathBuf,
    part_path: PathBuf,
}

impl PartFileWriter {
    pub fn new(final_path: impl AsRef<Path>) -> Self {
        let final_path = final_path.as_ref().to_path_buf();
        let part_path = derive_part_path(&final_path);

        Self {
            final_path,
            part_path,
        }
    }

    pub fn final_path(&self) -> &Path {
        &self.final_path
    }

    pub fn part_path(&self) -> &Path {
        &self.part_path
    }

    pub async fn prepare(&self, total_size: Option<u64>) -> Result<()> {
        if let Some(parent) = self.part_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&self.part_path)
            .await?;

        if let Some(total_size) = total_size {
            let metadata = file.metadata().await?;
            if metadata.len() < total_size {
                file.set_len(total_size).await?;
            }
        }

        Ok(())
    }

    pub async fn open_chunk_writer(&self, offset: u64) -> Result<PartFileChunkWriter> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&self.part_path)
            .await?;

        file.seek(SeekFrom::Start(offset)).await?;

        Ok(PartFileChunkWriter { file })
    }

    pub async fn sync_data(&self) -> Result<()> {
        if !self.part_path.exists() {
            return Ok(());
        }

        let file = OpenOptions::new().write(true).open(&self.part_path).await?;
        file.sync_data().await?;
        Ok(())
    }

    pub async fn commit(&self) -> Result<()> {
        self.sync_data().await?;
        fs::rename(&self.part_path, &self.final_path).await?;
        Ok(())
    }

    pub async fn remove_part_if_exists(&self) -> Result<()> {
        if self.part_path.exists() {
            fs::remove_file(&self.part_path).await?;
        }

        Ok(())
    }
}

pub struct PartFileChunkWriter {
    file: File,
}

impl PartFileChunkWriter {
    pub async fn write_all(&mut self, data: &[u8]) -> Result<()> {
        self.file.write_all(data).await?;
        Ok(())
    }

    pub async fn flush_and_sync(&mut self) -> Result<()> {
        self.file.flush().await?;
        self.file.sync_data().await?;
        Ok(())
    }
}

pub fn derive_part_path(final_path: &Path) -> PathBuf {
    match final_path.file_name() {
        Some(file_name) => {
            final_path.with_file_name(format!("{}.part", file_name.to_string_lossy()))
        }
        None => PathBuf::from(format!("{}.part", final_path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use tokio::fs;

    #[tokio::test]
    async fn preallocates_part_file_when_requested() {
        let temp_dir = tempdir().unwrap();
        let final_path = temp_dir.path().join("video.mp4");
        let writer = PartFileWriter::new(&final_path);

        writer.prepare(Some(4096)).await.unwrap();

        let metadata = fs::metadata(writer.part_path()).await.unwrap();
        assert_eq!(metadata.len(), 4096);
    }

    #[tokio::test]
    async fn writes_multiple_ranges_into_single_part_file() {
        let temp_dir = tempdir().unwrap();
        let final_path = temp_dir.path().join("video.mp4");
        let writer = PartFileWriter::new(&final_path);
        writer.prepare(Some(16)).await.unwrap();

        let mut first = writer.open_chunk_writer(0).await.unwrap();
        first.write_all(b"abcd").await.unwrap();
        first.flush_and_sync().await.unwrap();

        let mut second = writer.open_chunk_writer(8).await.unwrap();
        second.write_all(b"wxyz").await.unwrap();
        second.flush_and_sync().await.unwrap();

        let bytes = fs::read(writer.part_path()).await.unwrap();
        assert_eq!(&bytes[0..4], b"abcd");
        assert_eq!(&bytes[8..12], b"wxyz");
    }

    #[tokio::test]
    async fn commits_part_file_by_renaming_to_final_path() {
        let temp_dir = tempdir().unwrap();
        let final_path = temp_dir.path().join("video.mp4");
        let writer = PartFileWriter::new(&final_path);
        writer.prepare(None).await.unwrap();

        let mut chunk = writer.open_chunk_writer(0).await.unwrap();
        chunk.write_all(b"hello").await.unwrap();
        chunk.flush_and_sync().await.unwrap();

        writer.commit().await.unwrap();

        assert!(!writer.part_path().exists());
        assert!(writer.final_path().exists());
        let content = fs::read(writer.final_path()).await.unwrap();
        assert_eq!(content, b"hello");
    }
}
