/// <reference types="google.maps" />
import { useEffect, useRef } from "react";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";

type Marker = { lat: number; lng: number; title?: string; selected?: boolean };

type Props = {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: Marker[];
  onMarkerClick?: (index: number) => void;
  className?: string;
};

declare global {
  interface Window {
    google?: typeof google;
    __roamieInitMap?: () => void;
    __roamieMapReady?: Promise<void>;
  }
}

function loadMapsApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.google?.maps) return Promise.resolve();
  if (window.__roamieMapReady) return window.__roamieMapReady;

  const key = getGoogleMapsBrowserKey();

  window.__roamieMapReady = new Promise<void>((resolve, reject) => {
    window.__roamieInitMap = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__roamieInitMap`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("Failed to load Google Maps JavaScript API"));
    document.head.appendChild(s);
  });
  return window.__roamieMapReady;
}

export function GoogleMap({ center, zoom = 14, markers = [], onMarkerClick, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadMapsApi()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        if (!mapRef.current) {
          mapRef.current = new window.google.maps.Map(ref.current, {
            center,
            zoom,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: "greedy",
            styles: [
              { featureType: "poi", stylers: [{ visibility: "off" }] },
              { featureType: "transit", stylers: [{ visibility: "off" }] },
            ],
          });
        }
      })
      .catch((e) => console.error("[Roamie Maps] load failed", e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mapRef.current) mapRef.current.panTo(center);
  }, [center.lat, center.lng]);

  useEffect(() => {
    if (!mapRef.current || !window.google) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = markers.map((m, i) => {
      const marker = new window.google!.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map: mapRef.current!,
        title: m.title,
        animation: m.selected ? window.google!.maps.Animation.BOUNCE : undefined,
      });
      if (onMarkerClick) marker.addListener("click", () => onMarkerClick(i));
      return marker;
    });
  }, [markers, onMarkerClick]);

  return <div ref={ref} className={className} />;
}
