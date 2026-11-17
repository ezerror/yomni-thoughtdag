import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_YOMNI_HOST': '"1"' },
  build: {
    outDir: '../dist/host-app',
    emptyOutDir: true,
    lib: { entry: 'src/yomni-host.tsx', formats: ['es'], fileName: () => 'app.js', cssFileName: 'app' },
    rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom'], output: { inlineDynamicImports: true } },
  },
});
