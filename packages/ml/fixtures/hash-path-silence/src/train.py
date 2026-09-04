import json

import torch


def save_metadata(meta):
    with open("run.json", "w") as f:
        json.dump(meta, f)


def export(path):
    torch.save(torch.tensor(1.0), path)
    save_metadata({"git_commit": "abc"})
