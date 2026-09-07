from dataclasses import dataclass
import hashlib
import json


@dataclass
class GenerationConfig:
    n_episodes: int
    output_dir: str
    seed: int
    terminate_at: float


def fingerprint(config: GenerationConfig) -> str:
    payload = hashlib.sha256()
    payload.update(
        json.dumps({"seed": config.seed, "terminate_at": config.terminate_at}).encode()
    )
    return payload.hexdigest()
