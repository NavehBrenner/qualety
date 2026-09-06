import torch

def infer(x, model):
    torch.load("m.pt")
    mean = x.mean()
    std = x.std()
    x = (x - mean) / std
    return model(x)
