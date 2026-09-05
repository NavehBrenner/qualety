import torch

def predict(x, model):
    model.eval()
    with torch.inference_mode():
        return model(x)
