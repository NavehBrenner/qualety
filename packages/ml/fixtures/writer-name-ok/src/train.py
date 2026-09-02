import json
import torch

def log_run(meta):
    with open("run.json", "w") as f:
        json.dump(meta, f)

def train():
    loss = torch.tensor(1.0)
    loss.backward()
    log_run({"git_commit": "abc"})
