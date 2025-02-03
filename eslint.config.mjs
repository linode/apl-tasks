import { fixupConfigRules, fixupPluginRules } from '@eslint/compat'
import _import from 'eslint-plugin-import'
import prettier from 'eslint-plugin-prettier'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'

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
        "**/*.test.ts"
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
)), {
    plugins: {
        import: fixupPluginRules(_import),
        prettier: fixupPluginRules(prettier),
        "@typescript-eslint": fixupPluginRules(typescriptEslint),
    },

    languageOptions: {
        globals: {
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
        "@typescript-eslint/ban-ts-comment": "warn",
        "@typescript-eslint/member-delimiter-style": "off",
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/explicit-function-return-type": "warn",
        "@typescript-eslint/no-unsafe-assignment": "warn",
        "@typescript-eslint/no-unsafe-member-access": "warn",
        "@typescript-eslint/no-unsafe-return": "warn",
        "@typescript-eslint/no-unused-vars": "warn",
        "@typescript-eslint/no-unsafe-argument": "warn",
        "@typescript-eslint/no-use-before-define": "warn",
        "@typescript-eslint/restrict-template-expressions": "warn",
        "@typescript-eslint/no-base-to-string": "warn",
        "@typescript-eslint/no-empty-object-type": "warn",
        "@typescript-eslint/no-unsafe-call": "warn",
        "@typescript-eslint/no-non-null-assertion": "warn",
        "@typescript-eslint/no-floating-promises": "warn",
        "@typescript-eslint/no-redundant-type-constituents": "warn",
        "@typescript-eslint/no-shadow": "error",
        "func-names": "warn",
        "import/no-unresolved": "warn",
        "import/no-extraneous-dependencies": "warn",
        "import/extensions": "warn",
        "import/prefer-default-export": "warn",
        "eol-last": ["error", "always"],
        "no-shadow": "warn",
        "no-unused-vars": "warn",
        "prefer-destructuring": "error",
        "no-use-before-define": "warn",
        "no-console": "warn",
        "object-shorthand": "error",
        "no-debugger": "error",
        "prettier/prettier": "warn",

        "no-param-reassign": ["error", {
            props: true,
            ignorePropertyModificationsFor: ["memo"],
        }],

        "no-plusplus": [2, {
            allowForLoopAfterthoughts: true,
        }],
    },
}];
