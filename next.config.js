/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @huggingface/transformers runs in browser Worker (ONNX Runtime WASM/WebGPU).
  // Keep server bundle clean: don't bundle onnxruntime-node/sharp into client.
  webpack: (config, { isServer }) => {
    config.resolve.fallback = { ...(config.resolve.fallback || {}) };
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "onnxruntime-node": false,
        sharp: false,
      };
    }
    // transformers.js ships .onnx + wasm as assets; keep default asset handling
    config.experiments = { ...(config.experiments || {}), asyncWebAssembly: true };
    return config;
  },
};
module.exports = nextConfig;
