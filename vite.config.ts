import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // 注入 API_KEY
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY || ''),
    // 模拟 Node 环境变量
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    // 全局 global 模拟
    'global': 'window',
  },
  server: {
    port: 3000,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // 确保 Rollup 不会将这些作为外部模块
    rollupOptions: {
      external: []
    }
  }
});