def move(x, device):
    return x.to(device)


def cpu_only(x):
    return x.to("cpu")
