#!/usr/bin/env python3
import argparse
import html
import json
import re
from pathlib import Path
from typing import Optional


SCOPE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def extract_block(markdown: str, block_id: str) -> str:
    escaped = re.escape(str(block_id))
    pattern = re.compile(
        rf"<!--\s*anno:start\s+id=[\"']?{escaped}[\"']?[^>]*-->([\s\S]*?)"
        rf"<!--\s*anno:end\s+id=[\"']?{escaped}[\"']?\s*-->",
        re.IGNORECASE,
    )
    match = pattern.search(markdown)
    return match.group(1).strip() if match else ""


def resolve_source(config_path: Path, config: dict, markdown_file: str) -> Path:
    source_base = (config_path.parent / config.get("sourceBase", ".")).resolve()
    source_path = (source_base / markdown_file).resolve()
    try:
        source_path.relative_to(source_base)
    except ValueError as error:
        raise ValueError(f"markdownFile escapes sourceBase: {markdown_file}") from error
    return source_path


def page_key(page: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", str(page).lower()).strip("-")
    return normalized or "page"


def compile_config(config_path: Path, allow_unmapped: bool = False, scope_override: str = "") -> tuple[dict, list[str], list[dict]]:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    scope = scope_override or str(config.get("scope", "")).strip()
    errors = []
    if scope and not SCOPE_PATTERN.fullmatch(scope):
        errors.append(f"invalid scope '{scope}' in {config_path}; use lowercase kebab-case")

    compiled = []
    seen_page_ids = set()
    seen_keys = set()
    requirements = {}
    annotation_items = config.get("annotations", [])
    for item in config.get("sourceRequirements", []):
        requirement_id = str(item.get("id", "")).strip()
        if not requirement_id:
            errors.append(f"{config_path}: source requirement is missing id")
        elif requirement_id in requirements:
            errors.append(f"{config_path}: duplicate source requirement id: {requirement_id}")
        else:
            requirements[requirement_id] = item
    mapped_requirements = set()

    for index, item in enumerate(annotation_items):
        annotation = dict(item)
        annotation_id = str(annotation.get("id", "")).strip()
        if not annotation_id:
            errors.append(f"{config_path}: annotations[{index}] is missing id")
            continue
        page = str(annotation.get("page", "")).strip()
        page_id = (page, annotation_id)
        if page_id in seen_page_ids:
            errors.append(f"{config_path}: duplicate annotation id on page '{page}': {annotation_id}")
            continue
        seen_page_ids.add(page_id)

        selector = annotation.get("target", {}).get("selector", "").strip()
        if not selector:
            errors.append(f"{config_path}: annotation {annotation_id} is missing target.selector")

        markdown = annotation.get("markdown", "")
        markdown_file = annotation.get("markdownFile", "").strip()
        if markdown_file:
            try:
                source_path = resolve_source(config_path, config, markdown_file)
                if not source_path.exists():
                    errors.append(f"annotation {annotation_id} markdown file not found: {source_path}")
                else:
                    source_text = source_path.read_text(encoding="utf-8")
                    markdown = extract_block(source_text, annotation.get("blockId", annotation_id))
                    if not markdown:
                        errors.append(f"annotation {annotation_id} block not found in {source_path}")
            except ValueError as error:
                errors.append(f"annotation {annotation_id}: {error}")
        if not str(markdown).strip():
            errors.append(f"annotation {annotation_id} has no Markdown content")

        source_refs = [str(ref) for ref in annotation.get("sourceRefs", [])]
        for ref in source_refs:
            mapped_requirements.add(ref)
            if ref not in requirements:
                errors.append(f"annotation {annotation_id} references unknown requirement: {ref}")

        default_key = annotation_id
        if scope:
            default_key = f"{scope}:{page_key(page)}:{annotation_id}" if page else f"{scope}:{annotation_id}"
        annotation_key = str(annotation.get("key") or default_key)
        if annotation_key in seen_keys:
            errors.append(f"{config_path}: duplicate annotation key: {annotation_key}")
            continue
        seen_keys.add(annotation_key)
        annotation["id"] = annotation_id
        annotation["key"] = annotation_key
        annotation["scope"] = scope
        annotation["markdown"] = markdown
        annotation.pop("markdownFile", None)
        annotation.pop("blockId", None)
        compiled.append(annotation)

    compiled.sort(key=lambda item: (str(item.get("page", "")), item.get("order", 999999), str(item["id"])))
    coverage = []
    for requirement_id, requirement in requirements.items():
        coverage.append({
            "id": requirement_id,
            "key": f"{scope}:{requirement_id}" if scope else requirement_id,
            "scope": scope,
            "source": requirement.get("source", ""),
            "page": requirement.get("page", ""),
            "status": "mapped" if requirement_id in mapped_requirements else "unmapped",
            "annotations": [item["key"] for item in compiled if requirement_id in item.get("sourceRefs", [])],
        })
    if not allow_unmapped:
        errors.extend(f"unmapped source requirement: {item['key']}" for item in coverage if item["status"] == "unmapped")

    bundle = {
        "version": config.get("version", 1),
        "title": config.get("title", "Prototype Annotations"),
        "mermaid": config.get("mermaid", {}),
        "runtime": config.get("runtime", {}),
        "annotations": compiled,
        "coverage": coverage_summary(coverage),
    }
    return bundle, errors, coverage


def coverage_summary(coverage: list[dict]) -> dict:
    return {
        "total": len(coverage),
        "mapped": sum(item["status"] == "mapped" for item in coverage),
        "unmapped": sum(item["status"] == "unmapped" for item in coverage),
    }


def resolve_workspace_input(workspace_path: Path, item) -> tuple[Path, str, int]:
    if isinstance(item, str):
        relative_path, scope, order = item, "", 999999
    else:
        relative_path = item.get("config", "")
        scope = str(item.get("scope", "")).strip()
        order = item.get("order", 999999)
    if not relative_path:
        raise ValueError("workspace input is missing config")
    config_path = (workspace_path.parent / relative_path).resolve()
    if not config_path.exists():
        raise ValueError(f"workspace config not found: {config_path}")
    return config_path, scope, order


def compile_workspace(workspace_path: Path, allow_unmapped: bool = False) -> tuple[dict, list[str], list[dict], dict]:
    workspace = json.loads(workspace_path.read_text(encoding="utf-8"))
    errors = []
    annotations = []
    coverage = []
    seen_keys = set()

    for item in workspace.get("inputs", []):
        try:
            config_path, scope, workspace_order = resolve_workspace_input(workspace_path, item)
        except ValueError as error:
            errors.append(str(error))
            continue
        bundle, config_errors, config_coverage = compile_config(config_path, allow_unmapped, scope)
        errors.extend(config_errors)
        for annotation in bundle["annotations"]:
            key = annotation["key"]
            if key in seen_keys:
                errors.append(f"duplicate annotation key across workspace: {key}")
                continue
            seen_keys.add(key)
            annotation["workspaceOrder"] = workspace_order
            annotations.append(annotation)
        coverage.extend(config_coverage)

    if not workspace.get("inputs"):
        errors.append("workspace has no inputs")

    annotations.sort(key=lambda item: (
        item.get("workspaceOrder", 999999),
        str(item.get("page", "")),
        item.get("order", 999999),
        str(item.get("id", "")),
    ))
    for annotation in annotations:
        annotation.pop("workspaceOrder", None)

    bundle = {
        "version": workspace.get("version", 1),
        "title": workspace.get("title", "Prototype Annotations"),
        "mermaid": workspace.get("mermaid", {}),
        "runtime": workspace.get("runtime", {}),
        "annotations": annotations,
        "coverage": coverage_summary(coverage),
    }
    return bundle, errors, coverage, workspace


def coverage_markdown(coverage: list[dict]) -> str:
    lines = [
        "# 页面标注需求覆盖矩阵",
        "",
        "| 模块 | 来源需求 | 来源位置 | 页面 | 标注Key | 状态 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for item in coverage:
        annotations = ", ".join(f"`{value}`" for value in item["annotations"]) or "-"
        status = "已挂载" if item["status"] == "mapped" else "未挂载"
        lines.append(f"| {item['scope'] or '-'} | `{item['id']}` | {item['source']} | {item['page']} | {annotations} | {status} |")
    return "\n".join(lines) + "\n"


def render_inline(value: str) -> str:
    rendered = html.escape(value)
    rendered = re.sub(r"`([^`]+)`", r"<code>\1</code>", rendered)
    rendered = re.sub(
        r"\[([^\]]+)\]\(((?:https?://|/|#)[^)]+)\)",
        r'<a href="\2">\1</a>',
        rendered,
    )
    rendered = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", rendered)
    return re.sub(r"\*([^*]+)\*", r"<em>\1</em>", rendered)


def render_list(items: list[dict]) -> str:
    root = []
    stack = [(-1, root)]
    for item in items:
        while len(stack) > 1 and stack[-1][0] >= item["depth"]:
            stack.pop()
        node = {**item, "children": []}
        stack[-1][1].append(node)
        stack.append((item["depth"], node["children"]))

    def render_children(children: list[dict]) -> str:
        result = []
        index = 0
        while index < len(children):
            list_type = children[index]["type"]
            group = []
            while index < len(children) and children[index]["type"] == list_type:
                group.append(children[index])
                index += 1
            rows = []
            for item in group:
                nested = render_children(item["children"]) if item["children"] else ""
                rows.append(f"<li>{render_inline(item['text'])}{nested}</li>")
            result.append(f"<{list_type}>{''.join(rows)}</{list_type}>")
        return "".join(result)

    return render_children(root)


def render_markdown(markdown: str) -> str:
    lines = markdown.splitlines()
    output = []
    list_items = []

    def flush_list() -> None:
        if list_items:
            output.append(render_list(list_items))
            list_items.clear()

    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped or stripped.startswith("<!--"):
            flush_list()
            index += 1
            continue
        if stripped.startswith("```"):
            flush_list()
            language = stripped[3:].strip().lower()
            code_lines = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index])
                index += 1
            class_name = ' class="language-mermaid"' if language == "mermaid" else ""
            output.append(f"<pre><code{class_name}>{html.escape(chr(10).join(code_lines))}</code></pre>")
            index += 1
            continue
        if "|" in stripped and index + 1 < len(lines):
            separator = [cell.strip() for cell in lines[index + 1].strip().strip("|").split("|")]
            if len(separator) > 1 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in separator):
                flush_list()
                headers = [cell.strip() for cell in stripped.strip("|").split("|")]
                rows = []
                index += 2
                while index < len(lines) and "|" in lines[index]:
                    rows.append([cell.strip() for cell in lines[index].strip().strip("|").split("|")])
                    index += 1
                head = "".join(f"<th>{render_inline(cell)}</th>" for cell in headers)
                body = "".join(
                    "<tr>" + "".join(f"<td>{render_inline(row[pos] if pos < len(row) else '')}</td>" for pos in range(len(headers))) + "</tr>"
                    for row in rows
                )
                output.append(f"<div class=\"table-wrap\"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>")
                continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            flush_list()
            level = len(heading.group(1))
            output.append(f"<h{level}>{render_inline(heading.group(2))}</h{level}>")
            index += 1
            continue
        if stripped.startswith("> "):
            flush_list()
            output.append(f"<blockquote>{render_inline(stripped[2:])}</blockquote>")
            index += 1
            continue
        list_match = re.match(r"^(\s*)([-+*]|\d+\.)\s+(.+)$", line)
        if list_match:
            indent = len(list_match.group(1).replace("\t", "  "))
            list_items.append({
                "depth": indent // 2,
                "type": "ol" if list_match.group(2)[0].isdigit() else "ul",
                "text": list_match.group(3),
            })
            index += 1
            continue
        flush_list()
        output.append(f"<p>{render_inline(stripped)}</p>")
        index += 1
    flush_list()
    return "".join(output)


def html_document(bundle: dict) -> str:
    sections = []
    for annotation in bundle["annotations"]:
        export_id = annotation.get("key") if annotation.get("scope") else annotation["id"]
        title = html.escape(f"[{export_id}] {annotation.get('moduleName', '')}")
        rendered_markdown = render_markdown(annotation.get("markdown", ""))
        scope = html.escape(annotation.get("scope", ""))
        sections.append(f'<section><header><h2>{title}</h2><span class="scope">{scope}</span></header><article>{rendered_markdown}</article></section>')
    return """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>
body{{max-width:960px;margin:0 auto;padding:32px;font:14px/1.6 system-ui;color:#1f2937}}section{{padding:24px 0;border-bottom:1px solid #e5e7eb}}
header{{display:flex;align-items:center;gap:12px}}h1,h2,h3{{color:#111827}}.scope{{color:#64748b}}article p{{margin:0 0 12px}}
blockquote{{margin:12px 0;padding-left:12px;border-left:3px solid #cbd5e1;color:#475569}}pre{{padding:16px;overflow:auto;background:#f8fafc;border:1px solid #e5e7eb;white-space:pre-wrap}}
code{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}}.table-wrap{{overflow:auto}}table{{width:100%;border-collapse:collapse}}th,td{{padding:8px;border:1px solid #dbe2ea;text-align:left;vertical-align:top}}
</style></head><body><h1>{title}</h1>{sections}</body></html>
""".format(title=html.escape(bundle.get("title", "Prototype Annotations")), sections="".join(sections))


def resolve_optional_path(cli_value: str, document: dict, key: str, source_path: Path, default_name: str = "") -> Optional[Path]:
    if cli_value:
        return Path(cli_value).resolve()
    configured = document.get(key, "")
    if configured:
        return (source_path.parent / configured).resolve()
    return source_path.with_name(default_name) if default_name else None


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and compile annotation configs or a multi-module workspace.")
    parser.add_argument("source", help="annotation.config.json or annotation.workspace.json")
    parser.add_argument("--output", help="Output annotation.bundle.json. Workspace/config value is used when omitted.")
    parser.add_argument("--coverage", help="Optional coverage.md output path.")
    parser.add_argument("--html-output", help="Optional standalone rendered HTML output path.")
    parser.add_argument("--check", action="store_true", help="Validate only; do not write outputs.")
    parser.add_argument("--allow-unmapped", action="store_true", help="Allow source requirements without an annotation mapping.")
    args = parser.parse_args()

    source_path = Path(args.source).resolve()
    if not source_path.exists():
        raise SystemExit(f"Source does not exist: {source_path}")
    source_document = json.loads(source_path.read_text(encoding="utf-8"))
    if "inputs" in source_document:
        bundle, errors, coverage, source_document = compile_workspace(source_path, args.allow_unmapped)
    else:
        bundle, errors, coverage = compile_config(source_path, args.allow_unmapped)
    if errors:
        raise SystemExit("Annotation compile failed:\n- " + "\n- ".join(errors))
    if args.check:
        print(f"Valid: {len(bundle['annotations'])} annotations, {len(coverage)} source requirements")
        return

    output_path = resolve_optional_path(args.output, source_document, "output", source_path, "annotation.bundle.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Compiled annotation bundle: {output_path}")

    coverage_path = resolve_optional_path(args.coverage, source_document, "coverage", source_path)
    if coverage_path:
        coverage_path.parent.mkdir(parents=True, exist_ok=True)
        coverage_path.write_text(coverage_markdown(coverage), encoding="utf-8")
        print(f"Wrote coverage matrix: {coverage_path}")

    html_path = resolve_optional_path(args.html_output, source_document, "htmlOutput", source_path)
    if html_path:
        html_path.parent.mkdir(parents=True, exist_ok=True)
        html_path.write_text(html_document(bundle), encoding="utf-8")
        print(f"Wrote standalone HTML: {html_path}")


if __name__ == "__main__":
    main()
