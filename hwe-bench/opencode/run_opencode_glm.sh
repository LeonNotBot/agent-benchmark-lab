#!/usr/bin/env bash
# opencode + OpenRouter GLM-5.3 跑 HWE-bench，按批次切分 job，支持断点重跑
#
# 用法：
#   export OPENROUTER_API_KEY=sk-or-...
#   bash logs/run_opencode_glm.sh <repo> [batch]   # 跑全部批次，或只跑第 batch 批（从 0 开始）
#   bash logs/run_opencode_glm.sh <repo> score     # 汇总所有批次的 patch 并评分
# repo: ibex | cva6 | caliptra | rocketchip | xiangshan
#
# 断点重跑：中断后用同样的命令再跑一次即可，已完成的 trial 会被跳过。
# 注意不要修改下面的 harbor 参数，否则已有 job 无法续跑。
set -euo pipefail
cd "$(dirname "$0")/.."

BATCH_SIZE="${BATCH_SIZE:-10}"
N_CONCURRENT="${N_CONCURRENT:-2}"
# agent 固定为 opencode（见下方 harbor run -a opencode），模型固定为 OpenRouter 上的 GLM-5.3
MODEL="openrouter/tencent/hy4-preview"
# 试跑时可用 TAG=test 隔离 job 名，避免和正式 job 的配置冲突导致无法续跑
TAG="${TAG:-opencode-hy4}"

repo_key="${1:?用法: $0 <repo> [batch|score]}"
action="${2:-all}"

case "$repo_key" in
  ibex)       dataset=datasets/lowRISC__ibex.jsonl ;;
  cva6)       dataset=datasets/openhwgroup__cva6.jsonl ;;
  caliptra)   dataset=datasets/chipsalliance__caliptra-rtl.jsonl ;;
  rocketchip) dataset=datasets/chipsalliance__rocket-chip.jsonl ;;
  xiangshan)  dataset=datasets/OpenXiangShan__XiangShan.jsonl ;;
  *) echo "[ERROR] unknown repo: $repo_key" >&2; exit 2 ;;
esac

task_dir="tasks/hwe-bench-$repo_key"
job_prefix="hwe-$repo_key-$TAG"
result_dir="results/$job_prefix"

# ---------- 1. 生成 task 目录（镜像需齐全，否则 adapter 会失败） ----------
if [[ ! -d "$task_dir" ]]; then
  missing=$(python3 - "$dataset" <<'PY'
import json, subprocess, sys
for l in open(sys.argv[1]):
    r = json.loads(l)
    ref = "hwebench/%s_m_%s:pr-%d" % (r["org"].lower(), r["repo"].lower(), r["number"])
    if subprocess.run(["docker", "image", "inspect", ref], capture_output=True).returncode:
        print(ref)
PY
)
  if [[ -n "$missing" ]]; then
    echo "[ERROR] 以下镜像缺失，先拉取镜像：" >&2
    echo "$missing" >&2
    exit 1
  fi
  uv run python -m hwe_bench.harness.harbor.adapter --input "$dataset" --output "$task_dir/"
fi

# ---------- 3. 评分：汇总所有批次 ----------
if [[ "$action" == "score" ]]; then
  mkdir -p "$result_dir/patches"
  : > "$result_dir/patches/patches.jsonl"
  for job in jobs/"$job_prefix"-b*; do
    name=$(basename "$job")
    uv run python -m hwe_bench.harness.harbor.verify_bridge \
      --harbor-job-dir "$job" --output "$result_dir/batches/$name"
    cat "$result_dir/batches/$name/patches.jsonl" >> "$result_dir/patches/patches.jsonl"
  done
  uv run python -m hwe_bench.harness.evaluator \
    --workdir "$(pwd)/$result_dir/eval_workdir" \
    --patch_files "$(pwd)/$result_dir/patches/patches.jsonl" \
    --dataset_files "$(pwd)/$dataset" \
    --output_dir "$result_dir/eval" \
    --log_dir "$(pwd)/$result_dir/eval_logs" \
    --stop_on_error false --max_workers 4
  echo "[DONE] report: $result_dir/eval/final_report.json"
  exit 0
fi

# ---------- 2. 按批次运行 harbor ----------
: "${OPENROUTER_API_KEY:?请先 export OPENROUTER_API_KEY}"
mapfile -t tasks < <(ls "$task_dir" | sort -V)
n_batches=$(( (${#tasks[@]} + BATCH_SIZE - 1) / BATCH_SIZE ))
echo "[INFO] $repo_key: ${#tasks[@]} tasks, $n_batches batches of $BATCH_SIZE"

for (( b = 0; b < n_batches; b++ )); do
  [[ "$action" != "all" && "$action" != "$b" ]] && continue
  job_name=$(printf '%s-b%02d' "$job_prefix" "$b")
  filters=()
  for t in "${tasks[@]:b*BATCH_SIZE:BATCH_SIZE}"; do filters+=(-i "$t"); done
  echo "[BATCH $b/$((n_batches - 1))] $job_name: ${tasks[*]:b*BATCH_SIZE:BATCH_SIZE}"

  harbor run --path "$task_dir/" \
    -a opencode -m "$MODEL" \
    --ak version=1.19.3 \
    --ak 'opencode_config={"tools":{"webfetch":false,"websearch":false}}' \
    "${filters[@]}" \
    -k 1 -r 2 --n-concurrent "$N_CONCURRENT" \
    --agent-setup-timeout-multiplier 2.0 \
    --job-name "$job_name" \
    || echo "[WARN] batch $b exited non-zero, rerun this script to resume"
done
echo "[DONE] all requested batches finished. score with: $0 $repo_key score"
