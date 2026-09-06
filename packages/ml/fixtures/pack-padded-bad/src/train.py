import torch.nn as nn


def run(x):
    lstm = nn.LSTM(4, 8)
    out, h = lstm(x)
    return h
