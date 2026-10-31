import { defineConfig } from 'vitest/config';
import { modelShare } from './server/modelShare.ts';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
  // manifold-3d locates its .wasm relative to its own module; we pass the URL
  // explicitly, but pre-bundling still confuses it, so leave it alone.
  optimizeDeps: { exclude: ['manifold-3d'] },
  plugins: [modelShare()],
  // Bambu Studio's HTTP client only connects over IPv4, but Node binds
  // "localhost" to ::1 on macOS, so listen on the IPv4 loopback explicitly.
  server: { host: '127.0.0.1', port: 5200, strictPort: true },
  preview: { host: '127.0.0.1' },
  test: { environment: 'node' },
});
