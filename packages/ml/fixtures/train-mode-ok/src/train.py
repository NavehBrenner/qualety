def train(model, loss):
    model.eval()
    model.train()
    loss.backward()


def infer(model):
    model.eval()
