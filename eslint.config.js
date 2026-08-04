import js from "@eslint/js";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import globals from "globals";

export default [
  {
    ignores: [
      "build/**",
      "coverage/**",
      "dist/**",
      "icons/status/**",
      "node_modules/**"
    ]
  },
  js.configs.recommended,
  {
    files: ["background.js", "content.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    }
  },
  {
    files: ["eslint.config.js", "scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node
    }
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    plugins: {
      "no-unsanitized": noUnsanitized
    },
    rules: {
      "curly": ["error", "all"],
      "eqeqeq": ["error", "always"],
      "no-implicit-coercion": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "no-var": "error",
      "object-shorthand": "error",
      "prefer-const": "error"
    }
  }
];
