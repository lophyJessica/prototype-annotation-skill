# Prototype Annotation Skill v2

面向已有 React / Vue / 静态 HTML 原型的业务原型标注 Skill。

它把：

```text
PRD / 业务规则
→ 页面区域标注
→ 可交互的原型标注面板
→ 评审与研发交接
```

固化成一套可复用的工作流。

## 适用场景

- 给已有前端原型增加业务规则标注；
- 将 PRD 规则映射到页面区域；
- 生成“左侧原型 + 右侧标注”的评审体验；
- 检查原型与 PRD 的不一致；
- 为产品评审、研发交接和 AI 编码提供结构化业务说明。

## 仓库内容

```text
SKILL.md
agents/                         Agent 配置
assets/annotation-kit/          runtime、样式、schema 和配置模板
references/                     标注编写、范围判断、集成与交付参考
scripts/                        编译、资源校验和 kit 安装脚本
tests/                          编译脚本测试
```

## 核心工作流

```text
读取 PRD、字段清单与页面代码
→ 识别页面功能点
→ 判断该标/不该标
→ 生成区域级与整页级结构化标注
→ 编译 annotation bundle
→ 自动校验 bundle 完整性与 coverage
→ 注入 annotation runtime
→ 启动原型验证
→ 浏览器验收徽章、面板和定位
```

## 快速上手（具体用法）

下面几步把本 Skill（编译工具 + runtime + 校验）接进你自己的原型项目。**前提：你已有可运行的 React/Vue/静态 HTML 原型，且有 PRD/字段清单/业务规则**（没有则只能读方法论）。

### 1. 安装 runtime 资产
把 runtime.js / runtime.css / config / schema 拷进你项目的静态资源目录（Vite 通常是 `public/annotation-kit`）：
```bash
python3 <本skill目录>/scripts/install_annotation_kit.py <你的前端目录> \
  --public-path annotation-kit \
  --base-href ./annotation-kit \
  --inject --html <你的前端目录>/index.html
```
- 不想自动改 HTML 就去掉 `--inject`，按 `references/integration-patterns.md` 手动加两行：
  ```html
  <link rel="stylesheet" href="./annotation-kit/runtime.css">
  <script type="module" src="./annotation-kit/runtime.js"></script>
  ```
- Vite 项目用 `/annotation-kit`（public 资产）作 `--base-href`；静态站用相对 `./annotation-kit`。

### 2. 给页面加定位锚点
在需要标注的页面元素上加 `data-anno`（按功能区/表单区，尽量少，**不要逐字段**）：
```html
<section data-anno="basic-info"><!-- 基本信息区 --></section>
```
- 表单区/功能区 → 局部锚点；**整页级通用规则**（防重提交、未保存离开、页面准入、失败重试）→ 用 `page-global`，**不加锚点**。

### 3. 写标注
在 `<注释源>/annotations/pages/<page>.md` 里，用 `anno:start / anno:end` 注释包裹的 Markdown 写标注，每块含：
- `### 页面内容` / `### 交互说明` / `### 业务规则` / `### 字段说明` / `### 待确认` 五个小节；
- **字段说明用四列表格**：`字段 | 展示/输入类型 | 业务说明 | 约束与备注`；
- 覆盖字段级 / 页面级 / 业务级 / 系统级（见 `references/annotation-scope.md`）；
- 整页通用规则单独一个 `page-global` 块。
同时在 `annotations/annotation.config.json` 登记每页（引用 sourceRequirements、锚点 target、区块类型与顺序）。**详细格式 → `references/annotation-authoring.md`。**

### 4. 编译
```bash
# 单模块
python3 scripts/compile_annotations.py <模块>/annotation.config.json [--output <bundle路径>]
# 多模块（用 workspace 聚合，别手工合并 config）
python3 scripts/compile_annotations.py 需求文档与规则/annotation.workspace.json \
  --output public/annotation-kit/annotation.bundle.json
```
产物：`annotation.bundle.json`（放 runtime 同目录）。

### 5. 自动校验
```bash
python3 scripts/check_annotation_assets.py public/annotation-kit
```
期望输出 coverage 全映射、`unmapped: 0`（校验 bundle 完整性 / 无重复 id / markdown 已内联 / target 齐全 / coverage 存在）。

### 6. 浏览器验收
启动你的原型（如 `npm run dev`）：
1. 页面出现标注入口（区域序号/徽章）；
2. 点序号弹 6-tab 详情（页面内容/交互说明/业务规则/字段说明/待确认）；
3. 整页通用规则走 `page-global`，防重提交/未保存离开/准入有记录；
4. 各锚点命中。
**编译通过 ≠ 浏览器能看到**（build≠运行态），一定以打开页面实测为准。

### 修改与维护
- 说明文字不对 → 改 `annotations/*.md` 重编译；挂错区域 → 改 config/锚点；规则不对 → 回 PRD 确认。
- **不直接改 `annotation.bundle.json`**（下一轮编译会覆盖）。

## 重要原则

- 标注面向业务方和评审者，优先使用业务语言；
- 标注内容必须来自 PRD 或明确标记为“待确认”，不脑补业务规则；
- 普通表单字段按“基本信息”等区域聚合，不逐字段制造角标；
- 页面级通用规则使用无元素锚点的 `page-global`，集中记录防重提交、未保存离开、页面准入和失败重试；
- 每个标注块按页面内容、交互说明、业务规则、字段说明、待确认组织；
- 字段说明优先使用四列表格：字段、展示/输入类型、业务说明、约束与备注；
- 约束按字段级、区域级、整页级三层组织；
- 原型标注入口必须先显示区域序号，点击序号后再查看详情；
- 页面滚动、Tab 状态和待确认问题需要保持；
- 标注 runtime、bundle 与页面 `data-anno` 锚点必须同时存在并能命中；
- 每个页面的标注编号独立从 1 开始；
- 待确认是评审问题记录，不是从 PRD 自动抽取的内容；
- 只读审阅原型，不用标注 runtime 改变业务功能。

## 使用前提

本仓库不是下载后即可独立运行的完整应用，也不是一个自带页面和业务数据的标注平台。它提供的是：

```text
原型标注方法论 + runtime + 编译工具 + 参考资料
```

使用者必须先准备自己的“地基”：

- 已有的 React、Vue 或静态 HTML 原型项目；
- 项目自己的目录结构、入口文件和构建环境；
- 可供读取的 PRD、字段清单、业务规则和 Demo 规格；
- 能够被定位的页面 DOM 节点；
- 自己的页面功能和业务数据。

下载 Skill 后不会自动得到：

- 某个具体项目的页面；
- 任意特定项目的 PRD 和业务规则；
- 已经编译好的你自己项目的 annotation bundle；
- 自动适配你项目的页面锚点；
- 可直接访问的完整标注原型。

正确使用链路是：

```text
准备自己的项目和业务资料
→ 下载本 Skill
→ 按项目结构完成初始化和适配
→ 给自己的页面增加 data-anno 或稳定选择器
→ 根据自己的 PRD 和字段清单编写标注
→ 编译 bundle
→ 运行 check_annotation_assets.py
→ 在自己的原型中验收
```

如果没有已有原型项目、PRD 和业务规则，这个仓库只能用于阅读方法论和参考实现，不能单独产生完整的标注页面。

## 项目接入边界

这个仓库只提供通用原型标注能力，不包含：

- 任何特定项目的业务源码；
- 任何真实项目的 PRD、字段数据或审计材料；
- 任何外部服务的密钥；
- 特定项目的部署凭据；
- 真实业务数据库或后端服务。

接入其他项目时，需要在目标项目中根据实际技术栈、页面路径和 public 目录完成初始化，不要直接假设 React、Vue 或静态 HTML 项目结构完全一致。

## 许可证

当前仓库暂未附加开源许可证。未经仓库所有者明确授权，不要将其重新发布、售卖或作为其他产品的内置资产分发。

如需在团队或商业项目中使用，请先确认授权范围。
