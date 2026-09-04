import torch
from hashing import file_hash
from meta import save_metadata

torch.save(torch.tensor(1.0), "model.pt")
digest = file_hash("model.pt")
save_metadata({"git_commit": "abc", "artifact_hash": digest})
