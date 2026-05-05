use super::*;

impl DownloadManager {
    pub async fn verify_file_integrity(
        &self,
        file_path: &str,
        algorithm: HashAlgorithm,
    ) -> AppResult<IntegrityResult> {
        info!(
            "Starting manual integrity verification: {} with {:?}",
            file_path, algorithm
        );

        self.emit_event(DownloadEvent::IntegrityCheckStarted {
            task_id: "manual".to_string(),
            algorithm: format!("{:?}", algorithm),
        });

        let result = self
            .integrity_checker
            .compute_hash(file_path, algorithm)
            .await
            .map_err(|e| AppError::System(format!("Integrity verification failed: {}", e)))?;

        self.emit_event(DownloadEvent::IntegrityCheckCompleted {
            task_id: "manual".to_string(),
            result: result.clone(),
        });

        info!(
            "Manual integrity verification completed: {} - Valid: {}",
            file_path, result.is_valid
        );
        Ok(result)
    }

    pub async fn verify_batch_integrity(
        &self,
        files: Vec<(String, HashAlgorithm)>,
    ) -> AppResult<Vec<(String, IntegrityResult)>> {
        info!(
            "Starting batch integrity verification for {} files",
            files.len()
        );

        let mut results = Vec::new();
        for (file_path, algorithm) in files {
            match self
                .integrity_checker
                .compute_hash(&file_path, algorithm)
                .await
            {
                Ok(result) => results.push((file_path, result)),
                Err(e) => {
                    warn!("Failed to verify {}: {}", file_path, e);
                }
            }
        }

        info!(
            "Batch integrity verification completed: {} files",
            results.len()
        );
        Ok(results)
    }

    pub async fn compute_file_hash(
        &self,
        file_path: &str,
        algorithm: HashAlgorithm,
    ) -> AppResult<String> {
        info!("Computing hash for: {} with {:?}", file_path, algorithm);

        let result = self
            .integrity_checker
            .compute_hash(file_path, algorithm)
            .await
            .map_err(|e| AppError::System(format!("Hash computation failed: {}", e)))?;

        info!("Hash computed: {} - {}", file_path, result.computed_hash);
        Ok(result.computed_hash)
    }

    pub async fn set_expected_hash(&mut self, url: &str, hash: &str) -> AppResult<()> {
        self.config
            .expected_hashes
            .insert(url.to_string(), hash.to_string());
        info!("Set expected hash for {}: {}", url, hash);
        Ok(())
    }

    pub async fn remove_expected_hash(&mut self, url: &str) -> AppResult<()> {
        self.config.expected_hashes.remove(url);
        info!("Removed expected hash for: {}", url);
        Ok(())
    }

    pub fn get_expected_hashes(&self) -> &HashMap<String, String> {
        &self.config.expected_hashes
    }

    pub async fn set_auto_integrity_verification(&mut self, enabled: bool) -> AppResult<()> {
        self.config.auto_verify_integrity = enabled;
        info!(
            "Auto integrity verification: {}",
            if enabled { "enabled" } else { "disabled" }
        );
        Ok(())
    }

    pub async fn set_integrity_algorithm(&mut self, algorithm: HashAlgorithm) -> AppResult<()> {
        let algorithm_str = match algorithm {
            HashAlgorithm::Sha256 => "sha256",
            HashAlgorithm::Sha512 => "sha512",
            HashAlgorithm::Blake2b512 => "blake2b512",
            HashAlgorithm::Blake2s256 => "blake2s256",
            HashAlgorithm::Md5 => "md5",
            HashAlgorithm::Sha1 => "sha1",
        };

        self.config.integrity_algorithm = Some(algorithm_str.to_string());
        info!("Default integrity algorithm set to: {:?}", algorithm);
        Ok(())
    }
}
