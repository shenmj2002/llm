---
name: "table-to-paper-plot"
description: "Generates paper-style plots from confirmed table draft data. Invoke when user wants to turn structured table data into a publication-like chart with a specified or default style."
---

# Table To Paper Plot

将已确认的结构化表格数据转换为论文风格图表的专用 skill。

适用场景：
- 用户已经有表格数据，希望进一步生成图表
- 用户明确要求“按某种论文图风格出图”
- 用户要求以时间、数值列、分组列为基础生成折线图
- 用户已经确认表格无误，需要正式出图

不适用场景：
- 用户还没有表格，仍处于原始文本解析阶段
- 用户只是想解释数据，不需要图
- 用户需要的是通用图片生成，而不是数据图表

## 默认风格

如果用户没有额外指定风格，默认使用如下论文风折线图样式：
- 白底横向画布
- 黑色细边框坐标轴，四边框保留
- 一条 `y=0` 的灰色虚线参考线
- 细折线
- 蓝色圆点线、红色方点线作为默认系列视觉语言
- 系列名优先直接标注在图内，不强依赖图例
- 整体风格简洁、学术、偏论文图

## 输入要求

优先接收以下结构：

```json
{
  "tableDraft": {
    "title": "观测数据表",
    "columns": [
      { "key": "observedAt", "label": "观测时间" },
      { "key": "material", "label": "渗透材料" },
      { "key": "outflow", "label": "出流量" }
    ],
    "rows": [
      {
        "id": "row_1",
        "cells": {
          "observedAt": "1.6 22:10",
          "material": "2%",
          "outflow": 43.18
        }
      }
    ]
  },
  "xKey": "observedAt",
  "yKey": "outflow",
  "seriesKey": "material",
  "styleName": "paper-line-default"
}
```

其中：
- `tableDraft`：已经确认过、可用于出图的表格草稿
- `xKey`：横坐标字段
- `yKey`：纵坐标字段
- `seriesKey`：可选，分组字段；有该字段时可生成多条线
- `styleName`：可选，默认使用 `paper-line-default`

## 执行规则

1. 先验证表格数据是否完整
2. 检查 `xKey`、`yKey` 是否在表格列中存在
3. 如存在 `seriesKey`，按分组拆分多条线；否则生成单条线
4. 用户未指定样式时，应用默认论文风样式
5. 输出高清 PNG，并返回可展示与可下载结果

## 当前默认约定

对于当前项目中的表格确认链路，默认按以下方式解释：
- `xKey = observedAt`
- `yKey = outflow`
- `seriesKey = material`
- 默认样式名：`paper-line-default`

也就是说：
- 横轴默认是时间
- 纵轴默认是出流量
- 若有 `2% / 5% / 10%` 等材料维度，则默认按材料拆成多条线

## 输出要求

至少返回以下信息：

```json
{
  "status": "chart_ready",
  "imageUrl": "https://example.com/chart.png",
  "downloadUrl": "https://example.com/chart.png",
  "summary": "已按默认论文风样式生成折线图"
}
```

如果无法生成图像，应返回明确错误，而不是静默失败。

## 使用建议

- 如果用户给了参考图，应优先遵循参考图风格
- 如果用户没有指定风格，就使用默认论文风样式
- 如果用户要求“先确认表格再出图”，必须等表格确认后再执行
- 如果表格被用户编辑过，应以最终编辑后的表格为准

## 示例触发语句

- “把这个表格生成折线图”
- “按论文图风格画这张表”
- “确认表格后生成时间-出流量折线图”
- “把 2%、5%、10% 三条曲线画出来”

