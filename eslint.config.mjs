import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // self-host한 Monaco 정적 자산(node_modules에서 복사한 min 빌드) — 린트 대상 아님.
    "public/monaco/**",
    // self-host한 pdf.js 정적 자산(scripts/copy-pdfjs.mjs가 복사) — 역시 린트 대상 아님.
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;
