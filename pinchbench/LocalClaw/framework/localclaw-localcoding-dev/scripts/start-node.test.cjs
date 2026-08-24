const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadStartNodeModule({
  spawnSync,
  existsSync = () => false,
  env = {},
}) {
  const filePath = path.join(__dirname, "start-node.cjs");
  const source = fs.readFileSync(filePath, "utf8");
  const entryPointIndex = source.lastIndexOf("\ntry {");
  assert.notEqual(entryPointIndex, -1, "expected self-executing entry point");
  const sanitized = `${source.slice(0, entryPointIndex)}\nmodule.exports = { main };\n`;

  const sandbox = {
    module: { exports: {} },
    exports: {},
    __dirname,
    __filename: filePath,
    console: { log() {}, error() {} },
    process: {
      env,
      execPath: "node",
      version: "v22.14.0",
      versions: { modules: "127" },
      exit(code) {
        throw new Error(`unexpected process.exit(${code})`);
      },
    },
    require(id) {
      if (id === "path") return path;
      if (id === "fs") return { existsSync, readdirSync: () => [] };
      if (id === "child_process") return { spawnSync };
      if (id === "better-sqlite3") {
        return class Database {
          constructor(name) {
            this.name = name;
          }
          close() {}
        };
      }
      throw new Error(`unexpected require: ${id}`);
    },
  };

  vm.runInNewContext(sanitized, sandbox, { filename: filePath });
  return sandbox.module.exports;
}

test("main surfaces server start errors instead of treating them as sqlite incompatibility", () => {
  const spawnSync = (command, args) => {
    if (
      Array.isArray(args) &&
      args[0] &&
      String(args[0]).includes("server.cjs")
    ) {
      return { status: 1 };
    }
    return { status: 0, stdout: "v22.14.0\n" };
  };

  const { main } = loadStartNodeModule({ spawnSync });

  assert.throws(() => main(), /Start server failed with exit code 1/);
});
