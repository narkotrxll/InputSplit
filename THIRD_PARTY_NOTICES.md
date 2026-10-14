# Third-party notices

InputSplit is licensed under the MIT License (see `LICENSE`). It builds on the work listed
below. Each entry states what was used and under which license.

## Mechanisms ported (no files copied verbatim)

### ProtoInput — MIT License

<https://github.com/Ilyaki/ProtoInput> — Copyright (c) 2021 Ilyaki

The following techniques in `native/hook/` are adapted from ProtoInput's hook DLL
(`src/ProtoInput/ProtoInputHooks`): spoofing `GetForegroundWindow`/`GetActiveWindow`/`GetFocus`;
filtering `GetMessage`/`PeekMessage` by turning rejected messages into `WM_NULL`; reporting
neutral key state from `GetAsyncKeyState`/`GetKeyState`/`GetKeyboardState`; neutralising
`SetCursorPos`, `ClipCursor` and `GetCursorPos`; pre-loading every XInput DLL variant before
hooking; hooking the ordinal-100 `XInputGetStateEx`; remapping XInput user indexes to a chosen
controller slot. Each adapted function names its origin in a comment.

```
MIT License

Copyright (c) 2021 Ilyaki

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Not used: ProtoInput's OpenXinput dependency (GPL-3.0), EasyHook, BlackBone, Dear ImGui GUI.
No ProtoInput binaries are distributed with InputSplit.

### NoFocusLoss — The Unlicense (public domain)

<https://github.com/araghon007/NoFocusLoss>

The activation shield in `native/hook/activation_shield.cpp` (subclassing the game window and
swallowing `WM_ACTIVATE`, `WM_ACTIVATEAPP`, `WM_NCACTIVATE`, `WM_KILLFOCUS`,
`WM_IME_SETCONTEXT`) and the idea of blocking `SetCursorPos` while unfocused come from
NoFocusLoss. Credited with thanks although the Unlicense does not require it.

## Libraries compiled into the native binaries

### MinHook — BSD 2-Clause License

<https://github.com/TsudaKageyu/minhook> — fetched at build time (v1.3.4), statically linked into
`InputSplitHook64.dll`.

```
MinHook - The Minimalistic API Hooking Library for x64/x86
Copyright (C) 2009-2017 Tsuda Kageyu.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

 1. Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
 2. Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE), ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

MinHook also contains Hacker Disassembler Engine 64 C (HDE64), Copyright (c) 2008-2009
Vyacheslav Patkov, under the BSD 2-Clause License (same text as above).

### JSON for Modern C++ (nlohmann/json) — MIT License

<https://github.com/nlohmann/json> — Copyright (c) 2013-2025 Niels Lohmann. Fetched at build
time (v3.12.0), compiled into `inputsplit-helper.exe`. Full license text:
<https://github.com/nlohmann/json/blob/develop/LICENSE.MIT>.

## JavaScript dependencies

The desktop app bundles npm packages (Electron, Vue, Pinia, Reka UI, Lucide, vue-i18n, Zod,
fonts and others), each under its own permissive license (MIT, ISC, Apache-2.0 or SIL OFL for
fonts). The installer includes the complete list with license texts generated at build time
(`LICENSES.chromium.html` from Electron and `resources/licenses/`).
