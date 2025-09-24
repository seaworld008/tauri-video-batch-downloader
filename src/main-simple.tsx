import React from 'react';
import ReactDOM from 'react-dom/client';

// 最简化的测试应用
function SimpleApp() {
  return (
    <div style={{
      padding: '20px',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#f0f0f0',
      minHeight: '100vh'
    }}>
      <h1 style={{ color: '#333' }}>Video Downloader Pro - 测试版本</h1>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        如果您看到这个消息，说明React应用已成功启动！
      </p>
      
      <div style={{
        padding: '15px',
        backgroundColor: '#4CAF50',
        color: 'white',
        borderRadius: '5px',
        marginBottom: '10px'
      }}>
        ✅ React 渲染正常
      </div>
      
      <div style={{
        padding: '15px',
        backgroundColor: '#2196F3',
        color: 'white',
        borderRadius: '5px',
        marginBottom: '10px'
      }}>
        🚀 前端应用已加载
      </div>
      
      <div style={{
        padding: '15px',
        backgroundColor: '#FF9800',
        color: 'white',
        borderRadius: '5px'
      }}>
        🔧 白屏问题已修复
      </div>
      
      <p style={{ color: '#888', marginTop: '20px', fontSize: '14px' }}>
        这是一个简化的测试版本，用于验证基础渲染功能。
      </p>
    </div>
  );
}

// 简化的错误边界
class SimpleErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('SimpleErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          fontFamily: 'Arial, sans-serif',
          backgroundColor: '#ffebee',
          minHeight: '100vh'
        }}>
          <h1 style={{ color: '#c62828' }}>应用错误</h1>
          <p style={{ color: '#d32f2f' }}>
            应用程序遇到错误: {this.state.error?.message}
          </p>
          <pre style={{
            backgroundColor: '#ffcdd2',
            padding: '10px',
            borderRadius: '4px',
            overflow: 'auto',
            fontSize: '12px'
          }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

// 渲染应用
const rootElement = document.getElementById('root');
if (!rootElement) {
  document.body.innerHTML = '<div style="padding: 20px; color: red;">错误: 未找到root元素</div>';
} else {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <SimpleErrorBoundary>
        <SimpleApp />
      </SimpleErrorBoundary>
    );
    console.log('✅ Simple React app rendered successfully');
  } catch (error) {
    console.error('❌ Failed to render simple app:', error);
    document.body.innerHTML = `<div style="padding: 20px; color: red;">渲染错误: ${error}</div>`;
  }
}