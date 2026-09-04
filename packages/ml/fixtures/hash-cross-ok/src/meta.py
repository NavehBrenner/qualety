import json


def save_metadata(meta):
    with open("run.json", "w") as f:
        json.dump(meta, f)
