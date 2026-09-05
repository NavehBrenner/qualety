def move(x, device):
    x.to(device)
    x.cuda()
