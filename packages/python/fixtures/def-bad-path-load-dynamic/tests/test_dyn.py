import importlib.util
import os

spec = importlib.util.spec_from_file_location("m0", os.environ["MOD"])
mod = importlib.util.module_from_spec(spec)
mod.wrap(1)
