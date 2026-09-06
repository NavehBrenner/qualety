import torch.nn as nn
from torch.nn.utils.rnn import pack_padded_sequence


def run(x, lengths):
    lstm = nn.LSTM(4, 8)
    packed = pack_padded_sequence(x, lengths, batch_first=True)
    out, h = lstm(packed)
    return h


def output_only(x):
    lstm = nn.LSTM(4, 8)
    out, _ = lstm(x)
    return out
