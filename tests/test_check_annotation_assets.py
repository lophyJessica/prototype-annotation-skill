import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "check_annotation_assets.py"
SPEC = importlib.util.spec_from_file_location("check_annotation_assets", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def write_kit(root: Path, annotations: list[dict]) -> None:
    (root / "runtime.js").write_text("window.__annotationRuntime = true;", encoding="utf-8")
    (root / "runtime.css").write_text(".annotation {}", encoding="utf-8")
    (root / "annotation.bundle.json").write_text(
        json.dumps({
            "version": 1,
            "annotations": annotations,
            "coverage": {"total": 1, "mapped": 1, "unmapped": 0},
        }),
        encoding="utf-8",
    )


class AssetCheckerTests(unittest.TestCase):
    def test_accepts_compiled_page_global_annotation_without_selector(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_kit(root, [{
                "id": "1",
                "page": "/records",
                "type": "page-global",
                "target": {"selector": "", "fallbackSelectors": []},
                "markdown": "## 页面内容\n\n- 页面规则。",
            }])
            result = MODULE.check_assets(root)
            self.assertEqual(result["annotations"], 1)
            self.assertEqual(result["coverage"]["unmapped"], 0)

    def test_rejects_duplicate_id_on_same_page(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            annotation = {
                "id": "1",
                "page": "/records",
                "target": {"selector": "[data-anno='record-list']"},
                "markdown": "## 页面内容\n\n- 页面规则。",
            }
            write_kit(root, [annotation, dict(annotation)])
            with self.assertRaisesRegex(ValueError, "Duplicate annotation id per page"):
                MODULE.check_assets(root)


if __name__ == "__main__":
    unittest.main()
