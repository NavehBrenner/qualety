import importlib.util
from pathlib import Path

path = Path(__file__).resolve().parent.parent / "scripts" / "bag.py"
spec = importlib.util.spec_from_file_location("bag", path)
bag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bag)
bag.LoadedBag()
