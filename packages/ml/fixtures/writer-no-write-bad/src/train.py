import json
import torch

def save_metadata(meta):
    return json.dumps(meta)

def train():
    loss = torch.tensor(1.0)
    loss.backward()
    save_metadata({"git_commit": "abc"})
