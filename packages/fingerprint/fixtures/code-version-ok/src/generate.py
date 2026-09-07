from dataclasses import dataclass
import hashlib
import json

SCHEMA_VERSION = "1"
GIT_SHA = "deadbeef"


@dataclass
class GenerationConfig:
    seed: int


def fingerprint(config: GenerationConfig) -> str:
    payload = hashlib.sha256()
    payload.update(
        json.dumps(
            {"schema_version": SCHEMA_VERSION, "git": GIT_SHA, "seed": config.seed}
        ).encode()
    )
    return payload.hexdigest()
