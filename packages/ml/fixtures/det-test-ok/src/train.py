import torch

def train():
    loss = torch.tensor(1.0)
    loss.backward()
    return loss
