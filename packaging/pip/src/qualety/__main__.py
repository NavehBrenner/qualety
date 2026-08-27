import os
import subprocess
import sys


def main() -> None:
    name = "qualety.exe" if os.name == "nt" else "qualety"
    binary = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    if not os.path.isfile(binary):
        print(
            f"qualety: missing {name} next to the pip wrapper; install a platform wheel or use npm i qualety",
            file=sys.stderr,
        )
        raise SystemExit(2)
    argv = [binary, *sys.argv[1:]]
    if os.name == "nt":
        raise SystemExit(subprocess.call(argv))
    os.execv(argv[0], argv)


if __name__ == "__main__":
    main()
