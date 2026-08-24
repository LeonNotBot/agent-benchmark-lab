---
name: "数据分析"
description: "Python 数据科学与可视化"
icon: "📊"
category: "data"
routingPreference: "standard"
modelOverride: ""
skills:
  - brainstorming
initialPrompt: "我需要进行数据分析，请帮我探索数据集并生成可视化报告。"
builtin: true
---

# Python 数据科学最佳实践

## 数据处理

- 使用 Pandas 进行数据加载、清洗和转换，优先使用 vectorized 操作
- 妥善处理缺失值，记录处理策略和处理前后的数据统计
- 检查异常值和数据类型，必要时进行数据转换和标准化
- 使用 NumPy 进行数值计算，避免显式循环

## 可视化与报告

- 使用 Matplotlib、Seaborn 或 Plotly 创建清晰的可视化图表
- 图表包含标题、坐标轴标签和图例，确保可读性
- 生成 Jupyter Notebook 报告时，使用 Markdown 单元格说明分析步骤

## 代码质量

- 使用虚拟环境（venv 或 conda）管理依赖
- 将依赖写入 requirements.txt 或 environment.yml
- 使用有意义的变量名，添加必要的注释说明算法和逻辑

## 重现性与文档

- 设置固定的随机种子确保结果可重现
- 文档说明数据来源、处理步骤、假设和结论
- 关键的分析结果和图表应提供解释
