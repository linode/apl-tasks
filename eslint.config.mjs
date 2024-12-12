import { fixupConfigRules, fixupPluginRules } from "@eslint/compat";
import _import from "eslint-plugin-import";
import prettier from "eslint-plugin-prettier";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [{
    ignores: [
        "**/.history/",
        "**/.vscode/",
        "**/build",
        "**/dist",
        "**/coverage",
        "vendors/client/",
    ],
}, ...fixupConfigRules(compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:prettier/recommended",
    "prettier",
    "plugin:import/recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:chai-friendly/recommended",
)), {
    plugins: {
        import: fixupPluginRules(_import),
        prettier: fixupPluginRules(prettier),
        "@typescript-eslint": fixupPluginRules(typescriptEslint),
    },

    languageOptions: {
        globals: {
            ...globals.mocha,
            ...globals.node,
        },

        parser: tsParser,
        ecmaVersion: 2021,
        sourceType: "commonjs",

        parserOptions: {
            project: ["./tsconfig.json"],
        },
    },

    settings: {
        "import/resolver": {
            node: {
                extensions: [".ts"],
            },
        },
    },

    rules: {
        "@typescript-eslint/ban-ts-comment": "off",
        "@typescript-eslint/member-delimiter-style": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/no-use-before-define": "off",
        "@typescript-eslint/restrict-template-expressions": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/no-shadow": "error",
        "func-names": "off",
        "import/no-extraneous-dependencies": "off",
        "import/extensions": "off",
        "import/prefer-default-export": "off",
        "eol-last": ["error", "always"],
        "no-shadow": "off",
        "no-unused-vars": "warn",
        "prefer-destructuring": "error",
        "no-use-before-define": "off",
        "no-console": "off",
        "object-shorthand": "error",
        "no-debugger": "error",

        "no-param-reassign": ["error", {
            props: true,
            ignorePropertyModificationsFor: ["memo"],
        }],

        "no-plusplus": [2, {
            allowForLoopAfterthoughts: true,
        }],
    },
}];