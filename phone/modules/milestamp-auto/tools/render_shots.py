#!/usr/bin/env python3
"""안드로이드 오토 템플릿 시험 결과(JSON) → 차 화면 모양 그림(PNG).

DHU(데스크톱 헤드 유닛)에 붙일 안드로이드 오토 앱이 에뮬레이터에 없을 때 쓰는 대신 그림이다.
AutoScreensTest가 만든 build/auto-shots/*.json(템플릿 내용 그대로)을 안드로이드 오토 기본 모양(어두운 화면,
왼쪽 목록 카드·오른쪽 지도)으로 그려 크롬 헤드리스로 찍는다. 글·순서·버튼은 템플릿 값 그대로이고 모양만 흉내다.

python3 render_shots.py <json 폴더> <그림 폴더> [도장 그림 폴더]
"""
import html
import json
import os
import subprocess
import sys

SRC, DST = sys.argv[1], sys.argv[2]
STAMPS = os.path.abspath(sys.argv[3]) if len(sys.argv) > 3 else None
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
os.makedirs(DST, exist_ok=True)

TYPE_KO = {"PlaceListMap": "장소 목록 + 지도", "Pane": "안내 문단", "List": "목록", "Message": "메시지", "Grid": "격자"}
STAMP_OF = {"침산공원": "chimsan", "화본역": "hwabon", "국립대구과학관": "science"}
TYPE_KO["Pane+image"] = "안내 문단 + 큰 그림"

CSS = """*{box-sizing:border-box;margin:0;padding:0}
body{width:1280px;height:720px;background:#000;font-family:Pretendard,'Apple SD Gothic Neo',sans-serif;color:#fff;display:flex}
.rail{width:96px;background:#111;display:flex;flex-direction:column;align-items:center;padding-top:24px;gap:26px}
.rail i{width:40px;height:40px;border-radius:50%;background:#2a2a2a;display:block}.rail i.on{background:#2C4A3E;outline:3px solid #8fd0b0}
.main{flex:1;position:relative;overflow:hidden}
.map{position:absolute;inset:0;background:linear-gradient(135deg,#1d2a24,#16201c 40%,#1b2430);}
.map:before{content:'';position:absolute;inset:0;background-image:linear-gradient(#ffffff0d 1px,transparent 1px),linear-gradient(90deg,#ffffff0d 1px,transparent 1px);background-size:60px 60px}
.road{position:absolute;height:10px;background:#3a4a52;border-radius:6px}
.pin{position:absolute;width:44px;height:44px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#f2b230;display:flex;align-items:center;justify-content:center}
.pin b{transform:rotate(45deg);color:#1d1400;font-size:20px}
.me{position:absolute;width:22px;height:22px;border-radius:50%;background:#4f8cff;border:4px solid #fff}
.card{position:absolute;left:24px;top:24px;bottom:24px;width:520px;background:#202124;border-radius:24px;padding:22px 0;overflow:hidden}
.full{position:absolute;inset:24px;background:#202124;border-radius:24px;padding:22px 0;overflow:hidden}
.hd{display:flex;align-items:center;gap:14px;padding:0 26px 14px}
.hd .ic{width:40px;height:40px;border-radius:10px;background:#2C4A3E;display:flex;align-items:center;justify-content:center;font-weight:800;color:#f2b230}
.hd .back{font-size:30px;color:#ddd;width:40px;text-align:center}
.hd h1{font-size:28px;font-weight:700;letter-spacing:-.5px;flex:1}
.strip{position:absolute;right:28px;top:28px;display:flex;gap:10px;z-index:3}
.strip span{background:#303134;border-radius:22px;padding:10px 20px;font-size:20px}
.row{display:flex;gap:16px;padding:14px 26px;border-top:1px solid #ffffff14;align-items:center}
.row .n{width:36px;height:36px;border-radius:50%;background:#f2b230;color:#1d1400;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
.row h2{font-size:24px;font-weight:600}.row p{font-size:20px;color:#bdc1c6;margin-top:4px}
.row .chev{margin-left:auto;color:#777;font-size:26px}
.acts{display:flex;gap:16px;padding:20px 26px 0}
.acts span{flex:1;text-align:center;background:#303134;border-radius:40px;padding:18px;font-size:24px;font-weight:600}
.acts span.p{background:#2C4A3E;color:#fff}
.msg{display:flex;flex-direction:column;align-items:center;justify-content:center;height:520px;gap:22px;text-align:center}
.msg img,.msg .ph{width:200px;height:200px;border-radius:50%}
.msg .ph{background:#2C4A3E}
.msg p{font-size:32px;font-weight:700;white-space:pre-line;line-height:1.35}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;padding:6px 26px}
.cell{text-align:center}.cell img,.cell .ph{width:110px;height:110px;border-radius:50%;display:block;margin:0 auto 8px;background:#3c3c3c}
.cell .ph.on{background:#2C4A3E}
.cell h3{font-size:18px;font-weight:600}.cell p{font-size:15px;color:#9aa0a6}
.tag{position:absolute;right:20px;bottom:14px;font-size:14px;color:#ffffff66}
.pane2{position:absolute;inset:24px;display:grid;grid-template-columns:1fr 1.05fr;gap:22px}
.pane2 .l{display:flex;flex-direction:column;gap:10px;padding-top:4px}
.pane2 .l .hd{padding:0 4px 8px}
.pane2 .rc{background:#202124;border-radius:16px;padding:14px 18px}
.pane2 .rc h2{font-size:24px;font-weight:600}.pane2 .rc p{font-size:19px;color:#bdc1c6;margin-top:4px}
.pane2 .acts{margin-top:auto;padding:0}
.pane2 .im{border-radius:18px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center}
.pane2 .im img{width:100%;height:100%;object-fit:contain;display:block}
"""


def esc(s):
    return html.escape(s or "")


def stamp_img(name, bw=False):
    if not STAMPS:
        return None
    key = STAMP_OF.get(name)
    if not key:
        return None
    f = os.path.join(STAMPS, f"stamp_{key}.webp")
    return f if os.path.exists(f) else None


def header(j, back):
    left = '<span class="back">‹</span>' if back else '<span class="ic">M</span>'
    return f'<div class="hd">{left}<h1>{esc(j.get("title"))}</h1></div>'


def rows(j, numbered=False):
    out = []
    for i, r in enumerate(j.get("rows", [])):
        n = f'<span class="n">{esc(r.get("marker") or str(i + 1))}</span>' if numbered else ""
        texts = "".join(f"<p>{esc(t)}</p>" for t in r.get("texts", []))
        chev = '<span class="chev">›</span>' if r.get("click") else ""
        out.append(f'<div class="row">{n}<div><h2>{esc(r.get("title"))}</h2>{texts}</div>{chev}</div>')
    return "".join(out)


def strip(j):
    s = j.get("strip") or []
    return '<div class="strip">' + "".join(f"<span>{esc(a)}</span>" for a in s) + "</div>" if s else ""


def acts(j):
    a = j.get("actions") or []
    return '<div class="acts">' + "".join(f'<span class="{"p" if i == 0 else ""}">{esc(x)}</span>' for i, x in enumerate(a)) + "</div>"


def body(j):
    t = j["type"]
    if t == "PlaceListMap":
        pins = [(760, 210), (980, 420), (640, 470)]
        mp = '<div class="map"><div class="road" style="left:560px;top:330px;width:640px;transform:rotate(-12deg)"></div>'
        mp += '<div class="road" style="left:820px;top:120px;width:420px;transform:rotate(58deg)"></div>'
        for i, (x, y) in enumerate(pins[: len(j.get("rows", []))]):
            mp += f'<div class="pin" style="left:{x}px;top:{y}px"><b>{i + 1}</b></div>'
        mp += '<div class="me" style="left:700px;top:360px"></div></div>'
        return mp + strip(j) + f'<div class="card">{header(j, False)}{rows(j, True)}</div>'
    if t == "Pane" and j.get("image") and os.path.exists(os.path.join(SRC, j["image"])):
        # 안내 문단 + 큰 그림 (도장 메달): 왼쪽 글 줄·버튼, 오른쪽 합성 그림
        cards = "".join(
            f'<div class="rc"><h2>{esc(r.get("title"))}</h2>' + "".join(f"<p>{esc(x)}</p>" for x in r.get("texts", [])) + "</div>"
            for r in j.get("rows", []))
        img = os.path.abspath(os.path.join(SRC, j["image"]))
        return (f'<div class="pane2"><div class="l">{header(j, True)}{cards}{acts(j)}</div>'
                f'<div class="im"><img src="file://{img}"></div></div>')
    if t == "Pane":
        back = not j.get("title", "").endswith("귀가")
        return f'<div class="full">{header(j, back)}{rows(j)}{acts(j)}</div>'
    if t == "List":
        return strip(j) + f'<div class="full">{header(j, True)}{rows(j)}</div>'
    if t == "Message":
        name = (j.get("message") or "").split("! ")[-1].split(" ·")[0]
        img = stamp_img(name) if j.get("icon") else None
        pic = f'<img src="file://{img}">' if img else '<div class="ph"></div>'
        return f'<div class="full">{header(j, True)}<div class="msg">{pic}<p>{esc(j.get("message"))}</p></div>{acts(j)}</div>'
    if t == "Grid":
        cells = []
        for r in j.get("rows", []):
            got = "모았어요" in r.get("texts", [])
            img = stamp_img(r.get("title"), bw=not got)
            gray = "" if got else ' style="filter:grayscale(1);opacity:.45"'
            pic = f'<img src="file://{img}"{gray}>' if img else f'<div class="ph {"on" if got else ""}"></div>'
            cells.append(f'<div class="cell">{pic}<h3>{esc(r.get("title"))}</h3><p>{esc(" ".join(r.get("texts", [])))}</p></div>')
        return f'<div class="full">{header(j, True)}<div class="grid">{"".join(cells)}</div></div>'
    return f"<p>{esc(t)}</p>"


for fn in sorted(os.listdir(SRC)):
    if not fn.endswith(".json"):
        continue
    j = json.load(open(os.path.join(SRC, fn)))
    name = fn[:-5]
    page = (f'<!doctype html><meta charset="utf-8"><style>{CSS}</style>'
            f'<div class="rail"><i class="on"></i><i></i><i></i><i></i></div><div class="main">{body(j)}'
            f'<div class="tag">{esc(TYPE_KO.get(j["type"] + ("+image" if j.get("image") else ""), j["type"]))} 템플릿 · 시험 렌더(모양 흉내)</div></div>')
    hp = os.path.join(DST, name + ".html")
    open(hp, "w").write(page)
    png = os.path.join(DST, name + ".png")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                    f"--screenshot={png}", "--window-size=1280,720", "file://" + hp], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.remove(hp)
    print(png)
