import torch


def export(path):
    torch.save(torch.tensor(1.0), path)
