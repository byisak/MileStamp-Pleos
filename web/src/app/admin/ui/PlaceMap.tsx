"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ArrivalPoint } from "@/lib/catalog-shape";
import { loadMapLib } from "@/lib/map-loaders";
import { kakaoPlaceDriver, leafletPlaceDriver, type PlaceDriver } from "./place-map-drivers";

/** 도착 지점 색 (목록 점과 같은 순서). */
export const POINT_COLORS = ["#2C4A3E", "#3E63DD", "#C46F0C", "#B91C1C", "#7C3AED", "#0E7490", "#9A6400", "#55534E"];

/**
 * 도착 지점 지도 (카카오 지도, 키가 없거나 못 불러오면 OpenStreetMap). 지도를 누르면 고른(active) 지점이 그 자리로,
 * 핀은 끌어서 옮기고, 원 가장자리 흰 점을 끌면 반경(50~1500m)이 바뀐다. 바뀐 결과는 onChange로 (끌기는 놓을 때 한 번).
 * fitKey가 바뀌면(다른 명소) 원들이 다 보이게 맞춘다.
 */
export function PlaceMap(props: {
  points: ArrivalPoint[];
  active: number;
  fitKey: string;
  onChange: (points: ArrivalPoint[]) => void;
  onActive: (i: number) => void;
  onMoved?: (msg: string) => void;
  /** 지도 높이 (px). 바뀌면 지도를 다시 맞춘다 (작게 170 ↔ 크게 430). */
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const driver = useRef<PlaceDriver | null>(null);
  const fitted = useRef<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [engine, setEngine] = useState<"kakao" | "leaflet" | null>(null);
  // 지도 이벤트 손잡이가 늘 최신 값을 보게
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });

  useEffect(() => {
    let dead = false;
    loadMapLib().then((lib) => {
      if (dead || !el.current || driver.current) return;
      const first = latest.current.points[0];
      const handlers = {
        onMapClick(lat: number, lng: number) {
          const { points, active, onChange, onMoved } = latest.current;
          const i = Math.min(active, points.length - 1);
          onChange(points.map((p, k) => (k === i ? { ...p, lat, lng } : p)));
          onMoved?.(`${i + 1}번 도착 지점을 옮겼어요`);
        },
        onActive(i: number) { latest.current.onActive(i); },
        onCommit(i: number, v: { lat: number; lng: number; r: number }) {
          const { points, onChange } = latest.current;
          onChange(points.map((p, k) => (k === i ? { ...p, ...v } : p)));
        },
      };
      driver.current = lib.engine === "kakao"
        ? kakaoPlaceDriver(lib.kakao, el.current, first, handlers)
        : leafletPlaceDriver(lib.L, el.current, first, handlers);
      setEngine(lib.engine);
    }).catch((e: Error) => setErr(e.message));
    return () => {
      dead = true;
      driver.current?.destroy();
      driver.current = null;
    };
  }, []);

  // 높이가 바뀌면 (작게 ↔ 크게) 크기를 다시 재고 원들이 다 보이게
  const lastH = useRef(props.height);
  useEffect(() => {
    const d = driver.current;
    if (!engine || !d || lastH.current === props.height) return;
    lastH.current = props.height;
    d.resize();
    d.draw(latest.current.points, latest.current.active, POINT_COLORS, true);
  }, [engine, props.height]);

  useEffect(() => {
    const d = driver.current;
    if (!engine || !d) return;
    const fit = fitted.current !== props.fitKey;
    fitted.current = props.fitKey;
    d.draw(props.points, props.active, POINT_COLORS, fit);
  }, [engine, props.points, props.active, props.fitKey]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={el} className="map" data-engine={engine ?? undefined} style={props.height ? { height: props.height } : undefined} />
      {err ? <div className="hint warn" style={{ position: "absolute", left: 12, top: 12 }}>{err} · 인터넷 연결을 확인해 주세요</div> : null}
    </div>
  );
}
