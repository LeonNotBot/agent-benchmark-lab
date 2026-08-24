import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // all: 把未被任何用例 import 的源文件也计入分母，得到「诚实」的全量覆盖率。
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts", // 纯 re-export，无逻辑
        "src/**/*.spec.ts",
        "src/**/*.test.ts",
        "src/**/__tests__/**",
      ],
      reporter: ["text", "text-summary", "cobertura", "html"],
      reportsDirectory: "./coverage",
      // 覆盖率门禁（ratchet）：当前实测基线 ~25%，设为防回退底线。
      // 只升不降——补了测试后请相应调高这些数字。
      thresholds: {
        statements: 25,
        branches: 14,
        functions: 25,
        lines: 27,
      },
    },
  },
});
