from sklearn.preprocessing import StandardScaler

def train(x, y, model):
    scaler = StandardScaler()
    x = scaler.fit_transform(x)
    loss = model(x)
    loss.backward()
    return loss
