import torch
from sklearn.model_selection import train_test_split

def train(seed):
    train_test_split([1, 2, 3], [0, 1, 0], random_state=seed)
    loss = torch.tensor(1.0)
    loss.backward()
