"""Map INI and packed-section decoding; no renderer or analysis dependency."""
import base64
import hashlib
import math
import re
import struct
import runtime_bootstrap
import lzokay


def sha(data):
    return hashlib.sha256(data).hexdigest()


def ini(data, strict=False, *, irrelevant_duplicates=None):
    if isinstance(data, bytes):
        for encoding in ('utf-8-sig', 'cp936', 'cp1252'):
            try:
                data = data.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError('地图编码无法识别')
    result, current = {}, None
    for number, raw in enumerate(data.splitlines(), 1):
        line = raw.split(';', 1)[0].strip()
        if line.startswith('[') and line.endswith(']'):
            name = line[1:-1].strip().upper()
            if strict and name in result:
                raise ValueError(f'第 {number} 行有重复节 [{name}]，请先明确来源')
            current = result.setdefault(name, {})
        elif '=' in line and current is not None:
            key, value = line.split('=', 1)
            key = key.strip().upper()
            if strict and key in current and current[key] != value.strip():
                # Sight is not read by the static crate or image model. Record
                # the ambiguity without choosing an engine INI precedence.
                # All other conflicting keys retain the strict failure.
                if key == 'SIGHT' and irrelevant_duplicates is not None:
                    irrelevant_duplicates.append(dict(section=name, key=key, line=number,
                        values=[current[key], value.strip()]))
                else:
                    raise ValueError(f'第 {number} 行有重复键 {key}，无法无歧义计算')
            current[key] = value.strip()
    return result


def yes(value):
    return str(value).lower() in ('yes', 'true', '1')


def ini_integer(value):
    # YR 0x5276D0: $prefix / h suffix hex, otherwise C atoi (including "o" -> 0).
    value = str(value).strip()
    if value.startswith('$'):
        return int(value[1:], 16)
    if value.lower().endswith('h'):
        return int(value[:-1], 16)
    match = re.match(r'[+-]?\d+', value)
    return int(match[0]) if match else 0


def number(value):
    n = float(value.rstrip('%'))
    if not math.isfinite(n):
        raise ValueError('地形通行倍率不是有限数值')
    return n


def decode_lcw(data, expected):
    """Bounded Westwood Format80 decoder, including overlapping copies."""
    pos, out = 0, bytearray()
    relative = bool(data and data[0] == 0)
    if relative:
        pos = 1
    def byte():
        nonlocal pos
        if pos >= len(data):
            raise ValueError('LCW 输入截断')
        result = data[pos]; pos += 1
        return result
    def word():
        return byte() | byte() << 8
    while pos < len(data):
        command = byte()
        if command == 0x80:
            break
        if command < 0x80:
            length = (command >> 4) + 3
            start = len(out) - (((command & 15) << 8) | byte())
        elif command < 0xC0:
            length = command & 63
            if len(out)+length > expected or pos+length > len(data):
                raise ValueError('LCW 字面数据越界')
            out.extend(data[pos:pos+length]); pos += length
            continue
        elif command == 0xFE:
            length, value = word(), byte()
            if len(out)+length > expected:
                raise ValueError('LCW 填充越界')
            out.extend([value]*length)
            continue
        else:
            length = word() if command == 0xFF else (command & 63)+3
            offset = word()
            start = len(out)-offset if relative else offset
        if start < 0 or start >= len(out) or len(out)+length > expected:
            raise ValueError('LCW 回溯越界')
        for i in range(length):
            out.append(out[start+i])
    if len(out) != expected or pos != len(data):
        raise ValueError('LCW 解码长度不符')
    return bytes(out)


def decode_pack(m, name, folder, required=True):
    cfg = m.get(name.upper())
    if not cfg:
        if required:
            raise ValueError(f'缺少 [{name}]')
        return None
    if any(not k.isdigit() for k in cfg):
        raise ValueError(f'[{name}] 中有非数字块键')
    try:
        packed = base64.b64decode(''.join(cfg[k] for k in sorted(cfg, key=int)), validate=True)
    except Exception as e:
        raise ValueError(f'[{name}] 的 Base64 无效') from e
    pos = total = 0
    while pos < len(packed):
        if pos + 4 > len(packed):
            raise ValueError(f'[{name}] 压缩头不完整')
        size, expanded = struct.unpack_from('<HH', packed, pos)
        if not size or not expanded or expanded > 8192 or pos + size + 4 > len(packed):
            raise ValueError(f'[{name}] 压缩块长度无效')
        total += expanded
        pos += size + 4
    if not 0 < total <= 4000000:
        raise ValueError(f'[{name}] 解压尺寸超限')
    raw = bytearray()
    pos = 0
    while pos < len(packed):
        size, expanded = struct.unpack_from('<HH', packed, pos)
        payload = packed[pos+4:pos+4+size]
        try:
            block = decode_lcw(payload, expanded) if name.startswith('Overlay') else lzokay.decompress(payload, expanded)
        except Exception as error:
            raise ValueError(f'[{name}] 压缩数据损坏：{error}') from error
        if len(block) != expanded:
            raise ValueError(f'[{name}] 块输出长度不符')
        raw.extend(block)
        pos += size+4
    if len(raw) != total:
        raise ValueError(f'[{name}] 解压长度不一致')
    (folder / (name + '.bin')).write_bytes(raw)
    return bytes(raw)
