import torch
from torch.utils.data import DataLoader

loader = DataLoader([], batch_size=8)
loss = torch.tensor(1.0)
loss.backward()
