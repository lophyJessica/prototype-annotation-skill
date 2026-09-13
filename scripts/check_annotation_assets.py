#!/usr/bin/env python3
"""Check deployable prototype annotation assets.
No network or third-party dependencies. Validates the compiled annotation-kit dir:
bundle completeness, per-page unique ids, compiled-in markdown, target selectors, coverage.
This is NOT DOM mounting or remote hosting validation."""
import argparse
import json
from pathlib import Path


def check_assets(directory: Path) -> dict:
    for name in ('runtime.js', 'runtime.css', 'annotation.bundle.json'):
        p = directory / name
        if not p.is_file() or not p.stat().st_size:
            raise ValueError(f'Missing or empty asset: {p}')
    bundle = json.loads((directory / 'annotation.bundle.json').read_text(encoding='utf-8'))
    annots = bundle.get('annotations')
    if not isinstance(annots, list) or not annots:
        raise ValueError('Bundle has no annotations')
    seen = set()
    dups = []
    for a in annots:
        key = (a.get('page'), a.get('id'))
        if key in seen:
            dups.append(f'{a.get("page")}/{a.get("id")}')
        seen.add(key)
    if dups:
        raise ValueError(f'Duplicate annotation id per page: {sorted(set(dups))[:10]}')
    for a in annots:
        if a.get('markdownFile'):
            raise ValueError(f'Annotation {a.get("id")} still references source markdown; compile before publishing')
        if not a.get('markdown'):
            raise ValueError(f'Annotation {a.get("id")} missing compiled markdown')
        if not a.get('target'):
            raise ValueError(f'Annotation {a.get("id")} missing target selector')
    if not bundle.get('coverage'):
        raise ValueError('Bundle missing coverage export')
    return {
        'annotations': len(annots),
        'pages': len({a.get('page') for a in annots}),
        'version': bundle.get('version'),
        'coverage': bundle.get('coverage'),
    }


def main():
    ap = argparse.ArgumentParser(description='Validate prototype annotation deploy assets (not DOM mounting/hosting).')
    ap.add_argument('directory', help='annotation-kit dir, e.g. public/annotation-kit')
    args = ap.parse_args()
    print('Deployment assets valid: ' + json.dumps(check_assets(Path(args.directory).resolve()), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(f'Annotation assets invalid: {error}') from error
