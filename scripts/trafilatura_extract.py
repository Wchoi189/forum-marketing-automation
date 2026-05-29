#!/usr/bin/env python3
"""
stdin: raw HTML bytes
stdout: JSON { title, body, originalChars, cleanChars }
exit 0 on success, exit 1 on unrecoverable error
"""

import sys
import json
import trafilatura


def main() -> None:
    html = sys.stdin.read()
    original_chars = len(html)

    metadata = trafilatura.extract_metadata(html)
    title = ""
    if metadata:
        if metadata.title:
            title = metadata.title
        elif metadata.sitename:
            title = metadata.sitename

    body = trafilatura.extract(
        html,
        include_tables=True,
        include_links=False,
        no_fallback=False,
    ) or ""

    result = {
        "title": title,
        "body": body,
        "originalChars": original_chars,
        "cleanChars": len(body),
    }

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.stderr.write(f"trafilatura_extract error: {e}\n")
        sys.exit(1)
