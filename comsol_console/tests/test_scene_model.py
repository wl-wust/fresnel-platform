import json
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


CONSOLE_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = CONSOLE_DIR.parent
sys.path.insert(0, str(CONSOLE_DIR))


class SceneModelTests(unittest.TestCase):
    def test_standard_scene_matches_report_baseline(self):
        from scene_model import build_scene

        scene = build_scene()
        params = scene["parameters"]
        self.assertEqual(scene["schema"], "bp.comsol-scene/1")
        self.assertAlmostEqual(params["lambda_nm"], 589.3, places=6)
        self.assertAlmostEqual(scene["derived"]["d_paraxial_mm"], 0.901986, places=6)
        self.assertAlmostEqual(scene["derived"]["delta_x_mm"], 0.653336, places=6)
        self.assertAlmostEqual(scene["derived"]["delta_x_px"], 163.334, places=3)
        self.assertAlmostEqual(scene["derived"]["screen_x_mm"], 1000.0, places=6)

    def test_parameter_values_are_clamped_to_safe_ranges(self):
        from scene_model import clamp_parameter

        self.assertEqual(clamp_parameter("beta_deg", 9.0), 2.0)
        self.assertEqual(clamp_parameter("a_mm", 0.0), 5.0)
        self.assertEqual(clamp_parameter("z2_mm", 99999), 1500.0)
        self.assertEqual(clamp_parameter("lambda_nm", 100), 450.0)

    def test_config_round_trip_and_expression_mapping(self):
        from scene_model import (
            load_scene,
            save_scene,
            scene_parameter_expressions,
        )

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scene.json"
            scene = {
                "schema": "bp.comsol-scene/1",
                "parameters": {
                    "lambda_nm": 650.0,
                    "n_glass": 1.5145,
                    "beta_deg": 1.2,
                    "a_mm": 60.0,
                    "z2_mm": 900.0,
                    "slit_b_mm": 0.1,
                    "prism_half_height_mm": 15.0,
                    "prism_thickness_mm": 2.0,
                    "tip_half_mm": 0.03,
                },
            }
            save_scene(path, scene)
            loaded = load_scene(path)
            self.assertEqual(loaded["parameters"]["lambda_nm"], 650.0)
            expressions = scene_parameter_expressions(loaded)
            self.assertEqual(expressions["lambda0"], "650[nm]")
            self.assertEqual(expressions["beta"], "1.2[deg]")
            self.assertEqual(expressions["a"], "60[mm]")
            self.assertEqual(expressions["z2"], "900[mm]")

    def test_invalid_config_is_rejected(self):
        from scene_model import load_scene

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.json"
            path.write_text(json.dumps({"parameters": {}}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_scene(path)
            path.write_text(
                json.dumps({"schema": "bp.comsol-scene/1"}),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                load_scene(path)

    def test_preview_cli_does_not_import_comsol_backend(self):
        config = CONSOLE_DIR / "scenes" / "standard.json"
        code = (
            "import runpy,sys;"
            "sys.argv=['apply_scene.py','--mode','preview','--config',"
            f"{str(config)!r}];"
            "runpy.run_path("
            f"{str(CONSOLE_DIR / 'apply_scene.py')!r},run_name='__main__')"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=str(PROJECT_DIR),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["mode"], "preview")
        self.assertNotIn("mph", output)
        self.assertAlmostEqual(output["scene"]["derived"]["delta_x_mm"], 0.653336, places=6)

    def test_backend_writes_absolute_export_path(self):
        from scene_model import build_scene
        from comsol_backend import apply_scene_to_comsol

        recorded = {}

        class Runner:
            def run(self):
                recorded["run"] = recorded.get("run", 0) + 1

        class Component:
            def geom(self, tag):
                recorded["geometry"] = tag
                return Runner()

            def mesh(self, tag):
                recorded["mesh"] = tag
                return Runner()

        class ExportNode:
            def set(self, key, value):
                recorded[key] = value

            def run(self):
                Path(recorded["filename"]).write_text("ray data\n", encoding="utf-8")

        class Java:
            def component(self, tag):
                return Component()

            def study(self, tag):
                recorded["study"] = tag
                return Runner()

            def result(self):
                return mock.Mock(export=lambda *_args: ExportNode())

        class Model:
            java = Java()

            def parameter(self, name, expression):
                recorded.setdefault("parameters", {})[name] = expression

            def save(self, path):
                Path(path).write_bytes(b"fake mph")

        class Client:
            def load(self, path):
                recorded["model_path"] = str(path)
                return Model()

            def clear(self):
                recorded["cleared"] = True

        fake_mph = mock.Mock()
        fake_mph.Client.return_value = Client()
        fake_mph.__version__ = "test"

        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            sys.modules, {"mph": fake_mph}
        ):
            result = apply_scene_to_comsol(
                build_scene(),
                Path(tmp),
                solve=True,
                export=True,
            )
            self.assertEqual(result["warnings"], [])
            self.assertIn("filename", recorded)
            self.assertTrue(Path(recorded["filename"]).exists())
            self.assertTrue(Path(result["ray_data"]).is_absolute())
            self.assertTrue(Path(result["ray_data"]).exists())
            self.assertTrue(Path(recorded["filename"]).is_absolute())
            self.assertEqual(recorded["geometry"], "geom1")
            self.assertEqual(recorded["mesh"], "mesh1")
            self.assertEqual(recorded["study"], "std1")
            self.assertTrue(recorded["cleared"])


if __name__ == "__main__":
    unittest.main()
