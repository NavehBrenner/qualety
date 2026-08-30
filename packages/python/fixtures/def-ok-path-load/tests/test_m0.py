import importlib.util
from pathlib import Path

path = Path(__file__).resolve().parent.parent / "scripts" / "m0.py"
spec = importlib.util.spec_from_file_location("m0", path)
m0 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m0)
m0.per_axis_r(1)
