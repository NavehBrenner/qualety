import hashlib
import json
import attrs


@attrs.define
class GenerationConfig:
    seed: int
    terminate_at: float


def fingerprint(config: GenerationConfig) -> str:
    payload = hashlib.sha256()
    payload.update(
        json.dumps({"seed": config.seed, "terminate_at": config.terminate_at}).encode()
    )
    return payload.hexdigest()
