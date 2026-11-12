#!/usr/bin/env python3
"""도장 메달 소리 만들기 (시안 proto/auto-medal.html '들어 보기'와 같은 음) → android/src/main/res/raw/*.wav

  uv run --with numpy python3 tools/make_sounds.py

- medal_thud.wav: '쾅' 0.3초 — 사인 140→50Hz 미끄럼 + 아주 짧은 잡음(도장 닿는 소리), 지수 감쇠
- medal_chime_<종류>.wav: 짧은 축하음 — 세모파 음 3~4개를 0.12초 간격으로 (희귀·축제·다시는 다른 음)
"""
import os
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "android", "src", "main", "res", "raw")
os.makedirs(OUT, exist_ok=True)


def save(name, x):
    x = np.clip(x, -1, 1)
    pcm = (x * 32767 * 0.9).astype("<i2")
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(name, f"{len(x) / SR:.2f}s")


def thud():
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    # 140 → 50Hz 지수 미끄럼 (0.25초), 위상은 주파수 적분
    f = 140 * (50 / 140) ** np.minimum(t / 0.25, 1)
    phase = 2 * np.pi * np.cumsum(f) / SR
    env = 0.9 * (0.001 / 0.9) ** np.minimum(t / 0.3, 1)
    body = np.sin(phase) * env
    rng = np.random.default_rng(7)
    noise = rng.standard_normal(n)
    # 잡음은 낮은 쪽만 (이동 평균) · 30ms 안에 사라짐
    k = 24
    noise = np.convolve(noise, np.ones(k) / k, mode="same") * 2.2
    noise *= np.exp(-t / 0.012)
    attack = np.minimum(t / 0.003, 1)  # 딸깍 소리 없게
    return (body + 0.35 * noise) * attack


def tri(freq, t):
    return 2 / np.pi * np.arcsin(np.sin(2 * np.pi * freq * t))


def chime(notes, step=0.12):
    dur = step * (len(notes) - 1) + 0.4
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i, f in enumerate(notes):
        st = i * step
        tt = t - st
        on = tt >= 0
        env = np.where(tt < 0.02, tt / 0.02 * 0.25, 0.25 * (0.001 / 0.25) ** np.minimum((tt - 0.02) / 0.33, 1))
        x += np.where(on, tri(f, np.maximum(tt, 0)) * env, 0)
    return x * 1.6


save("medal_thud.wav", thud())
save("medal_chime_normal.wav", chime([784, 988, 1175]))
save("medal_chime_rare.wav", chime([784, 988, 1175, 1568]))
save("medal_chime_festival.wav", chime([659, 784, 988, 1319]))
save("medal_chime_again.wav", chime([659, 784]))
