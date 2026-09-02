import torch
from torch.utils.data import DataLoader

torch.manual_seed(0)
loader = DataLoader([], batch_size=8)
loss = torch.tensor(1.0)
loss.backward()
