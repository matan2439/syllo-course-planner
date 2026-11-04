"""Test-suite guard: no test may reach the network.

Every outbound socket connection to a non-loopback address is refused (RuntimeError, which
requests/urllib3 do not swallow as a connection error), and a test that attempted one fails at
teardown even if the code under test caught the error. Loopback (127.0.0.0/8, ::1, localhost) and
AF_UNIX stay allowed for local servers and asyncio's self-pipe. A test that genuinely needs the
network opts in with ``@pytest.mark.allow_network``.
"""
import ipaddress
import socket

import pytest

_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex
_attempts: list[str] = []
_allowed = False


def _is_local(address) -> bool:
    if not isinstance(address, tuple) or not address:
        return True  # AF_UNIX path or anything that is not an (host, port) pair
    host = str(address[0]).split("%", 1)[0]
    if host in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _check(sock, address):
    if _allowed or sock.family not in (socket.AF_INET, socket.AF_INET6) or _is_local(address):
        return
    _attempts.append(repr(address))
    raise RuntimeError(f"network access blocked in tests: connect to {address!r} "
                       "(stub the fetch, or mark the test @pytest.mark.allow_network)")


def _guarded_connect(self, address):
    _check(self, address)
    return _real_connect(self, address)


def _guarded_connect_ex(self, address):
    _check(self, address)
    return _real_connect_ex(self, address)


def pytest_configure(config):
    config.addinivalue_line("markers", "allow_network: the test may open non-loopback connections")
    socket.socket.connect = _guarded_connect
    socket.socket.connect_ex = _guarded_connect_ex


def pytest_unconfigure(config):
    socket.socket.connect = _real_connect
    socket.socket.connect_ex = _real_connect_ex


@pytest.fixture(autouse=True)
def _no_network(request):
    global _allowed
    _attempts.clear()
    _allowed = request.node.get_closest_marker("allow_network") is not None
    yield
    _allowed = False
    if _attempts:
        tried = sorted(set(_attempts))
        _attempts.clear()
        pytest.fail(f"test tried to reach the network: {tried}", pytrace=False)
