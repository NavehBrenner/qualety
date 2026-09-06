def move(x, device, model):
    x = x.to(device)
    model.to(device)
