from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from app.config import LLM_ALLOWED_HOSTS, LLM_TRUST_PROXY_DNS


PROXY_FAKE_IP_NETWORK = ipaddress.ip_network("198.18.0.0/15")


def _host_is_allowed(host: str, allowed_hosts: tuple[str, ...]) -> bool:
    if not allowed_hosts:
        return True
    for rule in allowed_hosts:
        if rule.startswith("*.") and host.endswith(rule[1:]) and host != rule[2:]:
            return True
        if host == rule:
            return True
    return False


def _require_public_ip(value: str, *, allow_proxy_fake_ip: bool = False) -> None:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise ValueError("AI API 域名解析结果无效") from exc
    if allow_proxy_fake_ip and address in PROXY_FAKE_IP_NETWORK:
        return
    if not address.is_global:
        raise ValueError("AI API 不允许指向本机、私网或保留地址")


def validate_llm_api_base(value: str, *, resolve_dns: bool = True) -> str:
    """Validate an outbound LLM base URL before every network request."""
    cleaned = (value or "").strip().rstrip("/")
    parsed = urlparse(cleaned)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("API Base 必须是有效的 HTTPS 地址")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("API Base 不能包含账号、查询参数或片段")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("API Base 端口无效") from exc
    if port not in {None, 443}:
        raise ValueError("AI API 仅允许标准 HTTPS 端口 443")

    host = parsed.hostname.lower().rstrip(".")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        _require_public_ip(str(literal))
    if not _host_is_allowed(host, LLM_ALLOWED_HOSTS):
        raise ValueError("AI API 域名不在 LLM_ALLOWED_HOSTS 白名单中")

    # Some local proxy/VPN products intentionally answer DNS with RFC 2544
    # benchmarking addresses. Trust that range only for an exact configured
    # hostname; wildcard or empty allowlists never enable this exception.
    allow_proxy_fake_ip = LLM_TRUST_PROXY_DNS and host in LLM_ALLOWED_HOSTS

    if literal is None and resolve_dns:
        try:
            records = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise ValueError("AI API 域名暂时无法解析") from exc
        addresses = {record[4][0] for record in records}
        if not addresses:
            raise ValueError("AI API 域名未解析到可用地址")
        for address in addresses:
            _require_public_ip(address, allow_proxy_fake_ip=allow_proxy_fake_ip)

    return cleaned
