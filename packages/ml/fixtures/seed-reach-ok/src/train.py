import torch

def train(seed):
    torch.manual_seed(seed)
    loss = torch.tensor(1.0)
    loss.backward()
