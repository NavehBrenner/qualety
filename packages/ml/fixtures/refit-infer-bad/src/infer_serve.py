import torch
from sklearn.preprocessing import StandardScaler

def infer(x):
    torch.load("m.pt")
    return StandardScaler().fit(x)
