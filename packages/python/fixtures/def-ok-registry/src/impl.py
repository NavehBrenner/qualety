def predict_style_average(tr, te):
    return tr


def predict_numerics_only(tr, te):
    return te


def predict_text_and_numerics(tr, te):
    return tr


METHODS = {
    "style-average": predict_style_average,
    "numerics-only": predict_numerics_only,
    "text+numerics": predict_text_and_numerics,
}

scores = {}
for name, fn in METHODS.items():
    scores[name] = fn(1, 2)
