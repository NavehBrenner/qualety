import argparse
import json
import torch

def save_metadata(meta):
    with open("run.json", "w") as f:
        json.dump(meta, f)

def train():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lr")
    args = parser.parse_args()
    loss = torch.tensor(1.0)
    loss.backward()
    save_metadata({"git_commit": "abc", "lr": args.lr})
