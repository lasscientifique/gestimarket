// Contrôle du code de l'interface (CI : job « qualite » de build.yml) : erreurs classiques de JavaScript et de
// TypeScript, et règles des hooks de React (appel conditionnel interdit, dépendances des effets signalées).
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri", "e2e/out", "aide", "demo", "public/compat.js"] },
  {
    files: ["src/**/*.{ts,tsx}", "vite.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Paramètres non utilisés gardés pour la lisibilité des signatures (préfixe « _ » sinon).
      "@typescript-eslint/no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // Réponses du moteur et des bibliothèques sans types précis.
      "@typescript-eslint/no-explicit-any": "off",
      // Espaces insécables voulus dans les textes et les expressions (montants à la française).
      "no-irregular-whitespace": ["error", { skipStrings: true, skipRegExps: true, skipTemplates: true, skipComments: true, skipJSXText: true }],
    },
  },
  {
    files: ["e2e/**/*.mjs", "scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }], "no-empty": ["error", { allowEmptyCatch: true }] },
  },
);
