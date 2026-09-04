import hashlib
import json
from pathlib import Path

import torch


def log_run(meta):
    with open("run.json", "w") as f:
        json.dump(meta, f)


torch.save(torch.tensor(1.0), "model.pt")
digest = hashlib.sha256(Path("model.pt").read_bytes()).hexdigest()
log_run({"git_commit": "abc", "artifact_hash": digest})
