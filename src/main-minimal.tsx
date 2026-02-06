import React from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/tauri';

function MinimalApp() {
  const [message, setMessage] = React.useState('Loading...');

  React.useEffect(() => {
    // 测试后端连接
    console.log('Trying to connect to backend...');

    invoke('test_hello')
      .then((response: unknown) => {
        console.log('✅ Backend connection successful:', response);
        setMessage(`✅ Backend connected: ${response}`);
      })
      .catch(error => {
        console.error('❌ Backend connection failed:', error);
        setMessage(`❌ Backend connection failed: ${error}`);
      });
  }, []);

  return (
    <div
      style={{
        padding: '20px',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#f0f0f0',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <h1>🔧 Video Downloader Pro - Connection Test</h1>
      <div
        style={{
          padding: '20px',
          backgroundColor: message.startsWith('✅')
            ? '#d4edda'
            : message.startsWith('❌')
              ? '#f8d7da'
              : '#fff3cd',
          border: `1px solid ${
            message.startsWith('✅') ? '#c3e6cb' : message.startsWith('❌') ? '#f5c6cb' : '#ffeaa7'
          }`,
          borderRadius: '5px',
          marginTop: '20px',
          minWidth: '300px',
          textAlign: 'center',
        }}
      >
        {message}
      </div>

      {message.startsWith('✅') && (
        <div style={{ marginTop: '20px', color: '#155724' }}>
          <strong>Connection successful!</strong> The Tauri backend is working properly.
        </div>
      )}
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<MinimalApp />);

  // 移除加载指示器
  const loading = document.querySelector('.loading');
  if (loading) {
    loading.remove();
  }
} else {
  console.error('Root container not found!');
}
