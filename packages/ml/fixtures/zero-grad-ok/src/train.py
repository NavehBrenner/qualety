def train(loss, optimizer):
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
