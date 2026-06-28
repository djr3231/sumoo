// Flat ESLint config (ESLint 9). Replaces the removed `next lint` command in
// Next.js 16 — see https://nextjs.org/docs/app/api-reference/config/eslint
import nextConfig from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "build/**", "next-env.d.ts"],
  },
  ...nextConfig,
];

export default eslintConfig;
