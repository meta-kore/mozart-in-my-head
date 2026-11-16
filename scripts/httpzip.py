"""Read members of a remote zip using HTTP range requests (no full download).

usage:
  python -I httpzip.py list URL [filter]
  python -I httpzip.py get URL MEMBER OUTFILE
"""
import sys
import urllib.request
import zipfile


class HttpFile:
    def __init__(self, url):
        self.url = url
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req) as r:
            self.final_url = r.geturl()
            self.size = int(r.headers["Content-Length"])
        self.pos = 0
        self.fetched = 0

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        if whence == 0:
            self.pos = offset
        elif whence == 1:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        # Read in generous chunks so small sequential reads don't each cost a request.
        want = max(n, 1 << 20) if n < (1 << 20) else n
        end = min(self.size, self.pos + want) - 1
        if getattr(self, "_buf_start", None) is not None and self._buf_start <= self.pos and self.pos + n <= self._buf_start + len(self._buf):
            off = self.pos - self._buf_start
            data = self._buf[off:off + n]
        else:
            req = urllib.request.Request(self.final_url, headers={"Range": f"bytes={self.pos}-{end}"})
            for attempt in range(6):
                try:
                    with urllib.request.urlopen(req, timeout=60) as r:
                        buf = r.read()
                    break
                except Exception:
                    if attempt == 5:
                        raise
                    import time; time.sleep(2 * (attempt + 1))
            self.fetched += len(buf)
            self._buf_start, self._buf = self.pos, buf
            data = buf[:n]
        self.pos += len(data)
        return data


def main():
    cmd, url = sys.argv[1], sys.argv[2]
    f = HttpFile(url)
    z = zipfile.ZipFile(f)
    if cmd == "list":
        flt = sys.argv[3] if len(sys.argv) > 3 else ""
        for i in z.infolist():
            if flt in i.filename:
                print(f"{i.file_size/1e6:9.1f} MB  {i.filename}")
        print(f"[{len(z.infolist())} entries, fetched {f.fetched/1e6:.1f} MB]", file=sys.stderr)
    elif cmd == "get":
        member, out = sys.argv[3], sys.argv[4]
        with z.open(member) as src, open(out, "wb") as dst:
            while True:
                b = src.read(1 << 22)
                if not b:
                    break
                dst.write(b)
        print(f"[fetched {f.fetched/1e6:.1f} MB]", file=sys.stderr)


if __name__ == "__main__":
    main()


def head(url, member, out, nbytes):
    """Save only the first nbytes of a member (enough for the start of a FLAC)."""
    f = HttpFile(url)
    z = zipfile.ZipFile(f)
    with z.open(member) as src, open(out, "wb") as dst:
        left = nbytes
        while left > 0:
            b = src.read(min(left, 1 << 20))
            if not b:
                break
            dst.write(b)
            left -= len(b)
    return f.fetched
