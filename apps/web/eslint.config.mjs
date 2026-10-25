import nextConfig from "@auro/eslint-config/next";

export default [
  ...nextConfig,
  { ignores: [".next/", ".next-local/", ".source/"] },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}"],
    rules: {
      "react/display-name": "off",
    },
  },
];
