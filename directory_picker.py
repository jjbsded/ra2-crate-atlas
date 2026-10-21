"""Native Windows folder picker; selection only, never saves configuration."""
from contextlib import contextmanager
import ctypes
from ctypes import wintypes as w
import os
from pathlib import Path
import uuid


class GUID(ctypes.Structure):
    _fields_ = [('data1', w.DWORD), ('data2', w.WORD), ('data3', w.WORD),
                ('data4', ctypes.c_ubyte*8)]

    @classmethod
    def parse(cls, value):
        return cls.from_buffer_copy(uuid.UUID(value).bytes_le)


def _method(pointer, index, *args):
    table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    return ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *args)(table[index])


def _check(result):
    if result < 0:
        raise ValueError(f'系统目录选择框无法完成操作（0x{result & 0xffffffff:08X}），请手动输入目录')


def _release(pointer):
    if pointer:
        _method(pointer, 2)(pointer)


@contextmanager
def _folder_dialog(initial=''):
    if os.name != 'nt':
        raise ValueError('当前系统不支持 Windows 目录选择框，请手动输入目录')
    ole = ctypes.WinDLL('ole32')
    ole.CoInitializeEx.argtypes = [ctypes.c_void_p, w.DWORD]
    ole.CoInitializeEx.restype = ctypes.c_long
    ole.CoCreateInstance.argtypes = [ctypes.POINTER(GUID), ctypes.c_void_p, w.DWORD,
                                    ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
    ole.CoCreateInstance.restype = ctypes.c_long
    ole.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    ole.CoTaskMemFree.restype = None
    ole.CoUninitialize.argtypes = []
    ole.CoUninitialize.restype = None
    _check(ole.CoInitializeEx(None, 2))  # The request thread owns an STA.
    dialog = ctypes.c_void_p()
    try:
        clsid = GUID.parse('DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7')
        iid = GUID.parse('D57C7288-D4AD-4768-BE02-9D969532D960')
        _check(ole.CoCreateInstance(ctypes.byref(clsid), None, 1, ctypes.byref(iid), ctypes.byref(dialog)))
        # IFileDialog slots from shobjidl_core.h: SetOptions=9, SetFolder=12,
        # SetTitle=17, SetOkButtonLabel=18, GetResult=20.
        # Pick folders, filesystem only, existing path, no cwd/recent-file changes.
        _check(_method(dialog, 9, w.DWORD)(dialog, 0x20 | 0x40 | 0x800 | 0x8 | 0x02000000))
        _check(_method(dialog, 17, w.LPCWSTR)(dialog, '选择地图对应的游戏根目录'))
        _check(_method(dialog, 18, w.LPCWSTR)(dialog, '选择此文件夹'))
        if initial.strip() and Path(initial).is_dir():
            shell = ctypes.WinDLL('shell32')
            shell.SHCreateItemFromParsingName.argtypes = [w.LPCWSTR, ctypes.c_void_p,
                ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
            shell.SHCreateItemFromParsingName.restype = ctypes.c_long
            item, item_iid = ctypes.c_void_p(), GUID.parse('43826D1E-E718-42EE-BC55-A1E261C37BFE')
            result = shell.SHCreateItemFromParsingName(str(Path(initial).resolve()), None, ctypes.byref(item_iid), ctypes.byref(item))
            try:
                if result >= 0:
                    _check(_method(dialog, 12, ctypes.c_void_p)(dialog, item))
            finally:
                _release(item)
        yield dialog, ole
    finally:
        _release(dialog)
        ole.CoUninitialize()


def choose_directory(initial=''):
    with _folder_dialog(initial) as (dialog, ole):
        result = _method(dialog, 3, w.HWND)(dialog, None)  # IModalWindow::Show
        if result & 0xffffffff == 0x800704C7:  # User cancelled.
            return None
        _check(result)
        item, value = ctypes.c_void_p(), ctypes.c_void_p()
        try:
            _check(_method(dialog, 20, ctypes.POINTER(ctypes.c_void_p))(dialog, ctypes.byref(item)))
            # IShellItem::GetDisplayName(SIGDN_FILESYSPATH).
            _check(_method(item, 5, w.DWORD, ctypes.POINTER(ctypes.c_void_p))(item, 0x80058000, ctypes.byref(value)))
            path = ctypes.wstring_at(value)
            if not Path(path).is_dir():
                raise ValueError('所选文件夹已不可用，请重新选择')
            return path
        finally:
            if value:
                ole.CoTaskMemFree(value)
            _release(item)
