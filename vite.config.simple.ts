import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 简化的Vite配置用于测试
export default defineConfig({
  plugins: [react()],
  
  // 清理构建输出
  clearScreen: false,
  
  // 服务器配置
  server: {
    port: 1420,
    strictPort: true,
  },
  
  // 环境变量
  envPrefix: ['VITE_', 'TAURI_'],
  
  // 构建配置
  build: {
    // 输出目录
    outDir: 'dist-simple',
    // 不压缩以便调试
    minify: false,
    // 生成source map
    sourcemap: true,
    // 目标环境
    target: 'esnext',
    // 清空输出目录
    emptyOutDir: true,
    // 关闭CSS代码分割
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        main: './index-simple.html'
      }
    }
  },
})