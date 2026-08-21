#!/usr/bin/env python3
import argparse
import shutil
from pathlib import Path


STYLE_TAG = '<link rel="stylesheet" href="{base}/runtime.css">'
SCRIPT_TAG = '<script type="module" src="{base}/runtime.js"></script>'


RUNTIME_FILES = ("runtime.js", "runtime.css")
OPTIONAL_FILES = ("annotation.config.json", "annotation.schema.json", "annotation.workspace.schema.json")


def resolve_destination(target_dir: Path, public_path: str) -> Path:
    destination = (target_dir / public_path).resolve()
    try:
        destination.relative_to(target_dir)
    except ValueError as error:
        raise SystemExit("--public-path must stay inside the target project") from error
    return destination


def copy_assets(skill_dir: Path, target_dir: Path, public_path: str, force_config: bool) -> Path:
    source = skill_dir / "assets" / "annotation-kit"
    destination = resolve_destination(target_dir, public_path)
    destination.mkdir(parents=True, exist_ok=True)

    for filename in RUNTIME_FILES:
        shutil.copy2(source / filename, destination / filename)

    for filename in OPTIONAL_FILES:
        target_file = destination / filename
        if force_config or not target_file.exists():
            shutil.copy2(source / filename, target_file)
    return destination


def inject_html(html_path: Path, base_href: str) -> bool:
    text = html_path.read_text(encoding="utf-8")
    style = STYLE_TAG.format(base=base_href.rstrip("/"))
    script = SCRIPT_TAG.format(base=base_href.rstrip("/"))
    changed = False

    if style not in text:
        if "</head>" in text:
            text = text.replace("</head>", f"  {style}\n</head>", 1)
        else:
            text = f"{style}\n{text}"
        changed = True

    if script not in text:
        if "</body>" in text:
            text = text.replace("</body>", f"  {script}\n</body>", 1)
        else:
            text = f"{text}\n{script}\n"
        changed = True

    if changed:
        html_path.write_text(text, encoding="utf-8")
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description="Install Vitamin Prototype Annotation runtime into a frontend prototype.")
    parser.add_argument("target", help="Target project or static output directory.")
    parser.add_argument("--public-path", default="annotation-kit", help="Destination folder inside target. Default: annotation-kit")
    parser.add_argument("--base-href", default="./annotation-kit", help="Href/src prefix used in HTML tags. Use /annotation-kit for Vite public assets.")
    parser.add_argument("--inject", action="store_true", help="Inject runtime tags into HTML files.")
    parser.add_argument("--html", action="append", default=[], help="HTML file to inject. Can be repeated. Defaults to target/index.html when --inject is used.")
    parser.add_argument("--force-config", action="store_true", help="Replace an existing annotation.config.json with the bundled template.")
    args = parser.parse_args()

    script_path = Path(__file__).resolve()
    skill_dir = script_path.parents[1]
    target_dir = Path(args.target).resolve()
    if not target_dir.exists():
        raise SystemExit(f"Target does not exist: {target_dir}")

    destination = copy_assets(skill_dir, target_dir, args.public_path, args.force_config)
    print(f"Copied annotation runtime to: {destination}")

    if args.inject:
        html_files = [Path(item).resolve() for item in args.html] if args.html else [target_dir / "index.html"]
        for html_path in html_files:
            try:
                html_path.relative_to(target_dir)
            except ValueError:
                print(f"Skipped HTML outside target: {html_path}")
                continue
            if not html_path.exists():
                print(f"Skipped missing HTML: {html_path}")
                continue
            changed = inject_html(html_path, args.base_href)
            print(f"{'Injected' if changed else 'Already present'}: {html_path}")


if __name__ == "__main__":
    main()
