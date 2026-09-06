def train(loss, optimizer):
    loss.backward()
    optimizer.step()
