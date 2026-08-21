# agent-benchmark-lab

benchmarks/: benchmark 的通用说明、安装方式、数据格式、任务筛选规则、官方链接、公共 adapter 逻辑
pinchbench/codex/: Codex 跑 PinchBench 的脚本、prompt、配置、手动记录
pinchbench/opencode/: OpenCode 跑 PinchBench 的脚本、配置、记录
configs/: 跨 benchmark/agent 复用的统一配置
scripts/: 跨组合复用的小工具，比如结果汇总、清理、转换格式
results/: 输出结果和实验记录


Manual experiment scripts, configs, and results for running different AI agents
against different benchmarks.

This repository is organized by benchmark first, then by agent:

```text
agent-benchmark-lab/
├── benchmarks/
├── pinchbench/
│   ├── codex/
│   ├── opencode/
│   ├── openclaw/
│   └── superclaw/
├── swebench/
│   ├── codex/
│   ├── opencode/
│   └── openclaw/
├── terminal-bench/
│   ├── codex/
│   └── opencode/
├── configs/
├── scripts/
└── results/
```

## Repository Model

Use directories for experiment combinations, not Git branches.

- Git branches should represent code lifecycle or version state.
- Benchmark and agent combinations should live in the main tree.
- Shared benchmark adapters, helper scripts, or upstream benchmark notes belong in
  `benchmarks/`.
- Shared run configuration belongs in `configs/`.
- Shared automation and utilities belong in `scripts/`.
- Outputs, summaries, and manual run records belong in `results/`.

## Naming

Use lowercase directory names:

```text
<benchmark>/<agent>/
```

Examples:

- `pinchbench/codex/`
- `pinchbench/opencode/`
- `swebench/openclaw/`
- `terminal-bench/codex/`

If one agent needs multiple versions or modes, put that variation inside the
agent directory instead of creating a branch:

```text
pinchbench/codex/
├── v0.2/
├── v0.3/
└── README.md
```

## Suggested Contents Per Agent Directory

Each `<benchmark>/<agent>/` directory can grow its own local workflow:

```text
README.md      # notes for this benchmark-agent combination
run.sh         # manual runner, if useful
config.yaml    # local overrides, if useful
notes.md       # observations from manual testing
```

