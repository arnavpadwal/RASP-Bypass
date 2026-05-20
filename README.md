# RASP-Bypass

A curated collection of **Runtime Application Self-Protection (RASP) bypasses** for Android applications. Each bypass is organized by vendor and SDK version, with documented hook points, architecture notes, and working Frida scripts.

## Purpose

Mobile RASP solutions embed security directly into apps to detect and block reverse engineering, tampering, hooking (Frida/Xposed), emulators, and rooted devices. This repo demonstrates practical bypass techniques for the most widely deployed RASP vendors — not for malicious use, but to:

- **Research & understand** how RASP protections work internally
- **Improve RASP products** by responsibly demonstrating gaps
- **Showcase security engineering** capability for consulting/employment opportunities

> **Ethical use only.** These techniques should only be applied to apps you own or have explicit permission to test.

## Vendor Coverage

| Vendor | Versions | Status |
|--------|----------|--------|
| [Protectt.ai (AI Protectt / KLO / YUI / BNM)](protectt.ai/) | [v4.6.2](protectt.ai/v4.6.2/) | ✅ Complete |
| _More coming soon..._ | | |

## Structure

```
RASP-Bypass/
├── README.md                          # This file
└── <vendor>/
    └── <version>/
        ├── README.md                  # Vendor-specific docs
        ├── bypass.js                  # Frida bypass script
        ├── native_stub.c              # Native shims (if needed)
        └── ...                        # Supporting files
```

## Approach

Each bypass targets **all known detection vectors** for that RASP version:

1. **Termination blocking** — `System.exit`, `Process.killProcess`, native `abort`
2. **Java-layer method hooking** — Detection classes, rule evaluators, integrity checks
3. **Native library stubbing** — Replace detection `.so` with no-op equivalents
4. **WebView/namespace fixes** — Android 14+ linker namespace issues for hybrid apps
5. **Property/variable overrides** — Build props, system properties, runtime flags

## Techniques Used

- **Frida Java bridge** (`Java.use`, `overload()`, `.implementation`) for hooking Java methods
- **Frida NativeCallbacks** + `Interceptor.replace` for native function stubs
- **Classloader-aware** `Runtime.loadLibrary0` to bypass `@FastNative` namespace issues
- **Module.load** for early native library injection
- **Overload iteration** via `.overloads` array for multi-signature methods
- **JNI stub compilation** (NDK) for `rrr()`-style version check replacements

## Target Profile

These bypasses target **real-world Android apps** — typically:

- Banking / fintech / insurance apps with regulatory compliance requirements
- Capacitor / Ionic / hybrid WebView-based architecture
- Apps using RASP SDKs with 100+ rule-based detection checks
- Both Java-layer and native-layer (JNI) detection engines
- PairIP, license check, and continuous self-monitoring loops

## Disclaimer

> This material is for **educational and authorized security research purposes only**. The authors are not responsible for misuse. If you work for a RASP vendor and identify a bypass, feel free to open an issue or PR with details.
