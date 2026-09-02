import json
import torch

def save_metadata(meta):
    with open("run.json", "w") as f:
        json.dump(meta, f)

def train():
    loss = torch.tensor(1.0)
    loss.backward()
