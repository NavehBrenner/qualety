def tokenize_words(source: str) -> list[str]:
    tokens: list[str] = []
    current = ""
    for ch in source:
        if ch.isalnum() or ch == "_":
            current += ch.lower()
            continue
        if len(current) > 0:
            tokens.append(current)
            current = ""
        if not ch.isspace():
            tokens.append(ch)
    if len(current) > 0:
        tokens.append(current)
    return [token for token in tokens if token not in ("--", "//")]
