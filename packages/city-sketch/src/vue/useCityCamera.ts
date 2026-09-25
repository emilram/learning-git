/**
 * useCityCamera: presets de camara, orbita programatica y autorrotacion para
 * la vista iso de <CitySketch>. Respeta prefers-reduced-motion y se detiene
 * cuando el usuario arrastra.
 */
import { onScopeDispose, shallowRef, watch, type Ref, type ShallowRef } from 'vue';
import { prefersReducedMotion } from './useZoomPan';

/** Subconjunto de la API expuesta por <CitySketch> que necesita la camara. */
export interface CameraTarget {
  setOrbit(rotation: number, pitch: number, resetCenter?: boolean): void;
  orbitBy(dRotation: number, dPitch?: number): void;
  getOrbit(): { rotation: number; pitch: number };
  flyTo(target: readonly [number, number] | null, zoom: number | null, duration?: number): void;
  readonly dragging: ShallowRef<boolean> | boolean;
}

export type CameraPresetName = 'hero' | 'bird' | 'street' | 'north' | 'east';

export const CAMERA_PRESETS: Readonly<Record<CameraPresetName, { readonly rotation: number; readonly pitch: number }>> = {
  hero: { rotation: 30, pitch: 55 },
  bird: { rotation: 35, pitch: 72 },
  street: { rotation: 25, pitch: 32 },
  north: { rotation: 0, pitch: 55 },
  east: { rotation: 90, pitch: 50 },
};

export interface CityCamera {
  readonly rotating: ShallowRef<boolean>;
  preset(name: CameraPresetName, resetCenter?: boolean): void;
  orbitTo(rotation: number, pitch: number, resetCenter?: boolean): void;
  /** Autorrotacion continua en grados por segundo (0 detiene). */
  autoRotate(degPerSecond: number): void;
  stop(): void;
  /** Un giro completo de 360 grados en `duration` ms. */
  spin(duration?: number): Promise<void>;
  flyTo(target: readonly [number, number] | null, zoom?: number | null, duration?: number): void;
}

export function useCityCamera(sketch: Ref<CameraTarget | null | undefined>): CityCamera {
  const rotating = shallowRef(false);
  let raf = 0;
  let speed = 0;
  let last = 0;

  const isDragging = (): boolean => {
    const d = sketch.value?.dragging;
    return typeof d === 'boolean' ? d : !!d?.value;
  };

  const tick = (now: number): void => {
    if (!rotating.value) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!isDragging()) sketch.value?.orbitBy(speed * dt, 0);
    raf = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    rotating.value = false;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const autoRotate = (degPerSecond: number): void => {
    stop();
    if (!degPerSecond || prefersReducedMotion()) return;
    speed = degPerSecond;
    rotating.value = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const spin = (duration = 2400): Promise<void> =>
    new Promise((resolve) => {
      const t = sketch.value;
      if (!t || prefersReducedMotion()) return resolve();
      stop();
      const start = t.getOrbit().rotation;
      const t0 = performance.now();
      rotating.value = true;
      const step = (): void => {
        const u = Math.min(1, (performance.now() - t0) / duration);
        const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        const cur = t.getOrbit().rotation;
        t.orbitBy(start + e * 360 - cur, 0);
        if (u < 1 && rotating.value) raf = requestAnimationFrame(step);
        else {
          rotating.value = false;
          resolve();
        }
      };
      raf = requestAnimationFrame(step);
    });

  const orbitTo = (rotation: number, pitch: number, resetCenter = false): void => {
    stop();
    sketch.value?.setOrbit(rotation, pitch, resetCenter);
  };
  const preset = (name: CameraPresetName, resetCenter = false): void => {
    const p = CAMERA_PRESETS[name];
    orbitTo(p.rotation, p.pitch, resetCenter);
  };
  const flyTo = (target: readonly [number, number] | null, zoom: number | null = null, duration?: number): void => {
    sketch.value?.flyTo(target, zoom, duration);
  };

  // Si el componente cambia (v-if), detener.
  watch(sketch, (v) => {
    if (!v) stop();
  });
  onScopeDispose(stop);

  return { rotating, preset, orbitTo, autoRotate, stop, spin, flyTo };
}
