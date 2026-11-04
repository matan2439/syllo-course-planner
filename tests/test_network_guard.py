"""The conftest network guard really blocks outbound connections (and lets loopback through)."""
from pathlib import Path

import pytest

pytest_plugins = ["pytester"]

CONFTEST = (Path(__file__).parent / "conftest.py").read_text(encoding="utf-8")


def test_outbound_http_fails_the_test_even_if_caught(pytester):
    pytester.makeconftest(CONFTEST)
    pytester.makepyfile(test_inner="""
        import requests

        def test_swallowed():
            try:
                requests.get("http://203.0.113.7/", timeout=1)  # TEST-NET-3, never routed
            except Exception:
                pass
    """)
    result = pytester.runpytest_inprocess("-p", "no:cacheprovider")
    result.assert_outcomes(passed=1, errors=1)
    result.stdout.fnmatch_lines(["*test tried to reach the network*203.0.113.7*"])


# The inner session's guard wraps this session's guard (in-process run), so the outer test opts in
# too; the inner opt-in connects to 0.0.0.0, which never leaves the machine.
@pytest.mark.allow_network
def test_loopback_and_opt_in_are_allowed(pytester):
    pytester.makeconftest(CONFTEST)
    pytester.makepyfile(test_inner="""
        import socket
        import pytest

        def test_loopback():
            srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1)
            c = socket.socket(); c.connect(srv.getsockname()); c.close(); srv.close()

        @pytest.mark.allow_network
        def test_opt_in():
            s = socket.socket(); s.settimeout(0.5)
            try:
                s.connect(("0.0.0.0", 9))  # not loopback for the guard, yet never leaves the machine
            except OSError:
                pass  # refused / not available: fine, the guard did not raise RuntimeError
            finally:
                s.close()
    """)
    result = pytester.runpytest_inprocess("-p", "no:cacheprovider")
    result.assert_outcomes(passed=2)
