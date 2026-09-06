def train(model, x):
    loss = model(x)
    loss.backward()
    return loss
