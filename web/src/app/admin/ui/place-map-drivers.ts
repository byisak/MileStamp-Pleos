// 관리자 도착 지점 지도의 그리기 두 벌 — 카카오(기본) · Leaflet(카카오 키가 없거나 못 불러올 때).
// 둘 다 같은 일: 원(반경) + 가운데 핀(끌어서 옮김) + 이름표 + 가장자리 흰 점(끌어서 반경) + 지도 누르면 고른 지점 이동.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { RADIUS_MAX, RADIUS_MIN, type ArrivalPoint } from "@/lib/catalog-shape";
import { distanceM, eastEdge } from "@/lib/map-embed";

export type DriverHandlers = {
  /** 빈 곳을 눌렀다 */
  onMapClick(lat: number, lng: number): void;
  onActive(i: number): void;
  /** 끌기를 놓았다 (가운데·반경) */
  onCommit(i: number, v: { lat: number; lng: number; r: number }): void;
};
export interface PlaceDriver {
  draw(points: ArrivalPoint[], active: number, colors: string[], fit: boolean): void;
  /** 지도 칸 크기가 바뀐 뒤 (작게 ↔ 크게) */
  resize(): void;
  destroy(): void;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const clampR = (r: number) => Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, Math.round(r / 10) * 10));

// ───────────────────────── 카카오 ─────────────────────────

export function kakaoPlaceDriver(kakao: any, el: HTMLElement, center: { lat: number; lng: number }, h: DriverHandlers): PlaceDriver {
  const K = kakao.maps;
  const ll = (lat: number, lng: number) => new K.LatLng(lat, lng);
  const map = new K.Map(el, { center: ll(center.lat, center.lng), level: 3 });
  map.addControl(new K.ZoomControl(), K.ControlPosition.RIGHT);
  K.event.addListener(map, "click", (e: any) => h.onMapClick(round6(e.latLng.getLat()), round6(e.latLng.getLng())));
  let items: any[] = [];

  /** 손가락·마우스로 끄는 겹그림 (카카오 Marker는 끄는 동안 알림이 없어 직접) */
  function draggable(node: HTMLElement, onStart: () => void, onMove: (lat: number, lng: number) => void, onEnd: () => void) {
    node.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      map.setDraggable(false);
      onStart();
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const p = map.getProjection().coordsFromContainerPoint(new K.Point(e.clientX - r.left, e.clientY - r.top));
        onMove(round6(p.getLat()), round6(p.getLng()));
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        map.setDraggable(true);
        onEnd();
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  }

  return {
    draw(points, active, colors, fit) {
      items.forEach((x) => x.setMap(null));
      items = [];
      points.forEach((pt0, i) => {
        const pt = { ...pt0 };
        const col = colors[i % colors.length];
        const on = i === active;
        const circle = new K.Circle({
          map, center: ll(pt.lat, pt.lng), radius: pt.r, strokeWeight: on ? 3 : 2, strokeColor: col, strokeOpacity: 1,
          strokeStyle: on ? "solid" : "dash", fillColor: col, fillOpacity: on ? 0.16 : 0.08,
        });
        const pin = document.createElement("div");
        pin.className = "kpin";
        pin.style.background = col;
        pin.title = `${i + 1}번 도착 지점 (끌어서 옮기기)`;
        const pinOv = new K.CustomOverlay({ map, position: ll(pt.lat, pt.lng), content: pin, xAnchor: 0.5, yAnchor: 1, zIndex: on ? 20 : 10, clickable: true });
        const lbl = document.createElement("div");
        lbl.className = "klbl";
        lbl.textContent = `${i + 1}. ${pt.name}`; // 이름은 글자로만
        const lblOv = new K.CustomOverlay({ map, position: ll(pt.lat, pt.lng), content: lbl, xAnchor: 0.5, yAnchor: 2.4, zIndex: on ? 21 : 11 });
        const hd = document.createElement("div");
        hd.className = "khandle";
        hd.style.borderColor = col;
        hd.title = "끌어서 반경 바꾸기";
        const edge = () => { const [a, b] = eastEdge(pt.lat, pt.lng, pt.r); return ll(a, b); };
        const hdOv = new K.CustomOverlay({ map, position: edge(), content: hd, xAnchor: 0.5, yAnchor: 0.5, zIndex: 30, clickable: true });
        const commit = () => h.onCommit(i, { lat: pt.lat, lng: pt.lng, r: pt.r });

        draggable(pin, () => h.onActive(i), (lat, lng) => {
          pt.lat = lat; pt.lng = lng;
          const p = ll(lat, lng);
          circle.setPosition(p); pinOv.setPosition(p); lblOv.setPosition(p); hdOv.setPosition(edge());
        }, commit);
        draggable(hd, () => h.onActive(i), (lat, lng) => {
          pt.r = clampR(distanceM([pt.lat, pt.lng], [lat, lng]));
          circle.setRadius(pt.r); hdOv.setPosition(edge());
        }, commit);
        items.push(circle, pinOv, lblOv, hdOv);
      });
      if (fit && points.length) {
        const b = new K.LatLngBounds();
        for (const p of points) {
          const pad = p.r * 1.6;
          const dLat = pad / 111320, dLng = pad / 111320 / Math.cos((p.lat * Math.PI) / 180);
          b.extend(ll(p.lat - dLat, p.lng - dLng));
          b.extend(ll(p.lat + dLat, p.lng + dLng));
        }
        map.setBounds(b);
      }
    },
    resize() { map.relayout(); },
    destroy() { items.forEach((x) => x.setMap(null)); items = []; el.innerHTML = ""; },
  };
}

// ───────────────────────── Leaflet (물러설 때) ─────────────────────────

export function leafletPlaceDriver(L: any, el: HTMLElement, center: { lat: number; lng: number }, h: DriverHandlers): PlaceDriver {
  const m = L.map(el, { zoomControl: true }).setView([center.lat, center.lng], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
  m.on("click", (e: any) => h.onMapClick(round6(e.latlng.lat), round6(e.latlng.lng)));
  let layers: any[] = [];

  return {
    draw(points, active, colors, fit) {
      layers.forEach((l) => m.removeLayer(l));
      layers = [];
      points.forEach((pt0, i) => {
        const pt = { ...pt0 };
        const col = colors[i % colors.length];
        const on = i === active;
        const circle = L.circle([pt.lat, pt.lng], { radius: pt.r, color: col, weight: on ? 3 : 2, fillColor: col, fillOpacity: on ? 0.16 : 0.08, dashArray: on ? undefined : "6 6" }).addTo(m);
        const marker = L.marker([pt.lat, pt.lng], { draggable: true }).addTo(m)
          .bindTooltip(`${i + 1}. ${pt.name}`, { permanent: true, direction: "top", className: "lbl", offset: [-14, -14] });
        const edge = () => L.latLng(...eastEdge(pt.lat, pt.lng, pt.r));
        const handle = L.circleMarker(edge(), { radius: 8, color: col, weight: 3, fillColor: "#fff", fillOpacity: 1, bubblingMouseEvents: false }).addTo(m);
        const commit = () => h.onCommit(i, { lat: pt.lat, lng: pt.lng, r: pt.r });
        marker.on("click", () => h.onActive(i));
        marker.on("dragstart", () => h.onActive(i));
        marker.on("drag", (e: any) => {
          pt.lat = round6(e.latlng.lat); pt.lng = round6(e.latlng.lng);
          circle.setLatLng(e.latlng); handle.setLatLng(edge());
        });
        marker.on("dragend", commit);
        handle.on("mousedown touchstart", (ev: any) => {
          m.dragging.disable();
          h.onActive(i);
          const move = (e: any) => {
            pt.r = clampR(m.distance([pt.lat, pt.lng], e.latlng));
            circle.setRadius(pt.r); handle.setLatLng(edge());
          };
          const up = () => {
            m.off("mousemove", move); m.off("mouseup", up);
            document.removeEventListener("mouseup", up);
            m.dragging.enable();
            commit();
          };
          m.on("mousemove", move); m.on("mouseup", up);
          document.addEventListener("mouseup", up, { once: true });
          L.DomEvent.stop(ev);
        });
        layers.push(circle, marker, handle);
      });
      if (fit) {
        const circles = layers.filter((l) => l instanceof L.Circle);
        if (circles.length) m.fitBounds(L.featureGroup(circles).getBounds().pad(0.6));
      }
    },
    resize() { m.invalidateSize(); },
    destroy() { m.remove(); },
  };
}
