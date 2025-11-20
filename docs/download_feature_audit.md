# ���ع�����״���ձ�

�������ڴ�����е� TODO / ռλʵ�ֽ���������ּ����ȷ����ÿ���׶���Ҫ���ǵ�ȱ�ڡ���ģ�黮�֣��г�λ����Ӱ��������

| ģ�� | �ļ�/λ�� | ��״���� | Ӱ��/��ע |
| --- | --- | --- | --- |
| ϵͳ������� | `src-tauri/src/main-original.rs:146` | `// TODO: Implement system_monitor`�������ȱ��ϵͳ��������߼� | ��׶� 4/�����أ���ǰ��Ӱ�����ص��������Ϊ�� |
| �������� | `src-tauri/src/commands/download.rs:244` | ✅ `retry_failed_tasks` �Ѿ�ʵ�֣�֧�ָ�ʧ������� | ǰ�ˡ�����ʧ�����񡱰�ť���Դ��� `DownloadManager::retry_failed` �첽���Ӹ����߼��� |
| Legacy downloader stub | `src-tauri/src/downloaders/m3u8_downloader_impl.rs` | �����ļ����׳� ��TODO: Implement M3U8 downloading�� | �Ա� `mod.rs` ���������ڽ׶� 1 �����Ա������� |
| Legacy downloader stub | `src-tauri/src/downloaders/youtube_downloader_impl.rs` | ͬ�ϣ�ֻ���� ��YouTube downloading not yet implemented�� | �׶� 1 ���� |
| ResumeDownloader ���� | `src-tauri/src/core/downloader.rs:324` | TODO������Ƭ���ؽ��Ȼ�д `DownloadTask` | Ŀǰ���ļ����Ȳ��ɼ����Խ׶� 1 �ؼ� |
| M3U8 ��Ƭ�ֽڷ�Χ | `src-tauri/src/core/m3u8_downloader.rs:314` | `byte_range: None // TODO` | �׶� 2 ��֧�ַ�Ƭ�ü����������� |
| M3U8 AES ���� | `src-tauri/src/core/m3u8_downloader.rs:414` | `_encryption_key` δʹ�ã�ע�� ��ʵ�ֽ��ܡ� | �޷������ܱ����� HLS���׶� 2 ��� |
| M3U8 �����ٶ�ͳ�� | `src-tauri/src/core/m3u8_downloader.rs:455` | `speed: 0.0 // TODO` | UI �޷���ʾ HLS �����ٶȣ��׶� 2 ���� |
| ���ع������ | `src-tauri/src/core/manager.rs:410` | ��Stop monitoring system when Arc issue is fixed�� �ȶ�� TODO��410, 920, 1014, 1592, 1655, 1661, 1667�� | ǣ���������ơ����ͳ�ơ��¼��ϱ����׶� 1/4 �𲽴��� |
| YouTube �����ư�װ | `src-tauri/src/core/youtube_downloader.rs:281` | ��Implement actual binary installation�� | �׶� 3 ��ʵ���Զ���װ/��� |
| YouTube ���� | ͬ�ļ� 292 | ��Implement actual binary update�� | �׶� 3 |
| YouTube ��Ƶ��Ϣ | ͬ�ļ� 307 | ��Implement actual video info fetching�� | Ŀǰ��Ϣ������ fallback���׶� 3 ʹ�� yt-dlp |
| YouTube ����ִ�� | ͬ�ļ� 373 | ��Implement actual download�� | ��ǰֻģ����ȣ���Ҫ�׶� 3 ʵ�� |
| YouTube ����ͼ | ͬ�ļ� 473 | ��Implement actual thumbnail download�� | �׶� 3 |
| YouTube ����ȡ�� | ͬ�ļ� 496 | ��Implement actual download cancellation�� | �׶� 3 |

> ˵���������б��۽������غ�����ص� TODO�������� UI ���ĵ���ֱ��Ӱ��ı�עδ���롣����ʵʩ�׶ΰ� `docs/download_implementation_plan.md` ִ�У����Ա���Ϊ������֤�嵥��
