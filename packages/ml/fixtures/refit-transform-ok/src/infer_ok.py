import torch

def infer(x, scaler):
    torch.load("m.pt")
    return scaler.transform(x)
