import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function stripV1Suffix(url: string): string {
  return url.replace(/\/$/, "").replace(/\/v1$/, "");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const defaultTarget = stripV1Suffix(
    env.VITE_OPENAI_BASE_URL || "https://api.deepseek.com",
  );

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/openai": {
          target: defaultTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/openai/, "/v1"),
          router: (req) => {
            const raw = req.headers["x-branch-chat-target"];
            const header = Array.isArray(raw) ? raw[0] : raw;
            if (header) return stripV1Suffix(header);
            return defaultTarget;
          },
        },
      },
    },
  };
});
