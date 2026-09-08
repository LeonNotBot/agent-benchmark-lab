# 人工确认对齐后的中文评分版

本项目只读取人工确认后的对齐文件，不再执行自动对齐。

## 质量等级

- 优秀：综合语义分 >= 0.90
- 中等：0.70 <= 综合语义分 < 0.90
- 不及格：综合语义分 < 0.70

Excel 汇总页会显示三档的数量、占比和等级分布图；
逐单元评测页会增加“质量等级”列。

## Linux 运行

```bash
source ~/Desktop/ceshizuizhong/translation_eval_final/.venv/bin/activate
cd ~/Desktop/ceshizuizhong/translation_eval_final_v3_manual_scoring
bash validate_manual_input.sh
bash run_manual_test.sh
```

结果目录：

```text
output_manual/S_R003S01C01/
```

重点查看：

- `S_R003S01C01_15min_manual_evaluation.xlsx`
- `S_R003S01C01_15min_manual_summary.json`
- `S_R003S01C01_15min_manual_alignment_preview.txt`
