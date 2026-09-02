import torch

torch.use_deterministic_algorithms(True)
loss = torch.tensor(1.0)
loss.backward()
