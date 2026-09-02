import torch
from train import train

def test_weights_match():
    first = train()
    second = train()
    assert torch.equal(first, second)
