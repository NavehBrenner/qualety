import importlib.util

spec = importlib.util.spec_from_file_location("m0", "/nope/outside.py")
mod = importlib.util.module_from_spec(spec)
mod.wrap(1)
