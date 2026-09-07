from dataclasses import dataclass
import hashlib
import json


@dataclass
class GenerationConfig:
    seed: int


def fingerprint(config: GenerationConfig) -> str:
    payload = hashlib.sha256()
    payload.update(json.dumps({"seed": config.seed}).encode())
    return payload.hexdigest()
