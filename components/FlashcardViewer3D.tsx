'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Loader2, Minus, Plus, Crosshair } from 'lucide-react';
import type { AppearanceSettings } from '@/types/flashcard';
import type { FlashcardModel, PartRole } from '@/lib/geometry/model';

export interface ViewerProps {
  model: FlashcardModel | null;
  building: boolean;
  error: string | null;
  /** the displayed model is older than the current settings (last build failed) */
  stale: boolean;
  /** changes when another card is selected: the camera returns to the default view */
  cardKey: string;
  placeMode: boolean;
  holeCenter: { x: number; y: number; diameter: number; enabled: boolean } | null;
  appearance: AppearanceSettings;
  onPlaceHole?: (xFromLeft: number, yFromTop: number) => void;
}

const MATERIALS: Record<PartRole, { color: string; roughness: number }> = {
  base: { color: '#f7f7f2', roughness: 0.55 },
  alphabet: { color: '#17171a', roughness: 0.45 },
  word: { color: '#17171a', roughness: 0.45 },
  'word-outline': { color: '#16a34a', roughness: 0.45 },
  'pattern-outline': { color: '#16a34a', roughness: 0.45 },
  image: { color: '#17171a', roughness: 0.45 },
  border: { color: '#16a34a', roughness: 0.45 },
};

const DEFAULT_DIR = new THREE.Vector3(0.3, 0.14, 1).normalize();
const SIDE_DIR = new THREE.Vector3(1, 0, 0);
const FRONT_DIR = new THREE.Vector3(0, 0, 1);
const BACK_DIR = new THREE.Vector3(0, 0, -1);

interface Anim {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  duration: number;
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

/** Camera distance that frames a W x H x D box seen from `dir`. */
function frameDistance(cam: THREE.PerspectiveCamera, dir: THREE.Vector3, size: THREE.Vector3, margin = 1.14): number {
  const d = dir.clone().normalize();
  const worldUp = Math.abs(d.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, d).normalize();
  const up = new THREE.Vector3().crossVectors(d, right).normalize();
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  const proj = (v: THREE.Vector3) => Math.abs(v.x) * hx + Math.abs(v.y) * hy + Math.abs(v.z) * hz;
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  const tanH = tanV * cam.aspect;
  return Math.max((proj(up) * margin) / tanV, (proj(right) * margin) / tanH) + proj(d);
}

export default function FlashcardViewer3D({ model, building, error, stale, cardKey, placeMode, holeCenter, appearance, onPlaceHole }: ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    modelGroup: THREE.Group;
    floor: THREE.Group;
    marker: THREE.Group;
    keyLight: THREE.DirectionalLight;
    anim: Anim | null;
    needsRender: boolean;
    size: THREE.Vector3;
    center: THREE.Vector3;
    surfaceZ: number;
    dims: { w: number; h: number } | null;
  } | null>(null);

  const lastCardKey = useRef<string | null>(null);
  const lastDims = useRef<string | null>(null);
  const placeModeRef = useRef(placeMode);
  const onPlaceRef = useRef(onPlaceHole);
  placeModeRef.current = placeMode;
  onPlaceRef.current = onPlaceHole;

  // ------------------------------------------------------------------ scene setup (once)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
    } catch (e) {
      setWebglError(e instanceof Error ? e.message : 'WebGL could not be started.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.setAttribute('data-testid', 'viewer-canvas');
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 4000);
    camera.position.set(60, 40, 330);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xc9ced6, 1.15));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(70, 110, 170);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.12;
    keyLight.shadow.radius = 3;
    scene.add(keyLight);
    scene.add(keyLight.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-120, 30, 90);
    scene.add(fill);
    const back = new THREE.DirectionalLight(0xffffff, 1.5);
    back.position.set(-40, 50, -160);
    scene.add(back);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    const floor = new THREE.Group();
    scene.add(floor);
    const marker = new THREE.Group();
    marker.visible = false;
    scene.add(marker);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 0.9;
    controls.rotateSpeed = 0.8;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    const state = {
      renderer,
      scene,
      camera,
      controls,
      modelGroup,
      floor,
      marker,
      keyLight,
      anim: null as Anim | null,
      needsRender: true,
      size: new THREE.Vector3(80, 100, 4),
      center: new THREE.Vector3(0, 0, 2),
      surfaceZ: 3,
      dims: null as { w: number; h: number } | null,
    };
    three.current = state;

    controls.addEventListener('start', () => {
      state.anim = null;
    });
    controls.addEventListener('change', () => {
      state.needsRender = true;
    });

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 2 || h < 2) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      state.needsRender = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // click (not drag) on the card places the hole while "place on 3D view" is active
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || !placeModeRef.current || !onPlaceRef.current) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 700) return;
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -state.surfaceZ);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit) || !state.dims) return;
      const { w, h } = state.dims;
      if (Math.abs(hit.x) > w / 2 || Math.abs(hit.y) > h / 2) return;
      onPlaceRef.current(hit.x + w / 2, h / 2 - hit.y);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const a = state.anim;
      if (a) {
        const t = Math.min(1, (performance.now() - a.start) / a.duration);
        const k = 1 - Math.pow(1 - t, 3);
        camera.position.lerpVectors(a.fromPos, a.toPos, k);
        controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
        if (t >= 1) {
          camera.position.copy(a.toPos);
          controls.target.copy(a.toTarget);
          state.anim = null;
        }
        state.needsRender = true;
      }
      const changed = controls.update();
      if (changed || state.needsRender) {
        renderer.render(scene, camera);
        state.needsRender = false;
        // camera telemetry, used by the automated tests to verify the view buttons
        const p = camera.position;
        const tg = controls.target;
        const r = (v: number) => Math.round(v * 100) / 100;
        container.dataset.camera = `${r(p.x)},${r(p.y)},${r(p.z)}`;
        container.dataset.target = `${r(tg.x)},${r(tg.y)},${r(tg.z)}`;
        // GPU resource counts (used by the tests to prove obsolete geometry is released)
        const mem = renderer.info.memory;
        container.dataset.gpu = `${mem.geometries},${mem.textures}`;
        // where the four corners of the card's front face appear on screen (canvas pixels)
        if (state.dims) {
          const { w, h } = state.dims;
          const cw = renderer.domElement.clientWidth;
          const ch = renderer.domElement.clientHeight;
          const pts = [
            [-w / 2, h / 2],
            [w / 2, h / 2],
            [w / 2, -h / 2],
            [-w / 2, -h / 2],
          ].map(([x, y]) => {
            const v = new THREE.Vector3(x, y, state.surfaceZ).project(camera);
            return `${r(((v.x + 1) / 2) * cw)},${r(((1 - v.y) / 2) * ch)}`;
          });
          container.dataset.corners = pts.join(';');
          container.dataset.canvas = `${cw},${ch}`;
        }
      }
    };
    loop();

    return () => {
      // a new scene (e.g. after a StrictMode remount) must be framed again
      lastCardKey.current = null;
      lastDims.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      disposeObject(modelGroup);
      disposeObject(floor);
      disposeObject(marker);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // ------------------------------------------------------------------ camera helpers
  const goTo = useCallback((dir: THREE.Vector3, animate = true) => {
    const t = three.current;
    if (!t) return;
    // Flush any leftover damping inertia from a previous drag; otherwise it would nudge the
    // camera away from the exact view when the animation ends.
    t.controls.enableDamping = false;
    t.controls.update();
    t.controls.enableDamping = true;
    const dist = frameDistance(t.camera, dir, t.size);
    const toTarget = t.center.clone();
    const toPos = toTarget.clone().add(dir.clone().normalize().multiplyScalar(dist));
    const span = Math.max(t.size.x, t.size.y);
    t.controls.minDistance = span * 0.3;
    t.controls.maxDistance = span * 9;
    if (!animate) {
      t.camera.position.copy(toPos);
      t.controls.target.copy(toTarget);
      t.controls.update();
      t.needsRender = true;
      return;
    }
    t.anim = {
      fromPos: t.camera.position.clone(),
      fromTarget: t.controls.target.clone(),
      toPos,
      toTarget,
      start: performance.now(),
      duration: 380,
    };
  }, []);

  const fitKeepingDirection = useCallback(() => {
    const t = three.current;
    if (!t) return;
    const dir = t.camera.position.clone().sub(t.controls.target);
    if (dir.lengthSq() < 1e-6) dir.copy(DEFAULT_DIR);
    goTo(dir, true);
  }, [goTo]);

  const zoom = useCallback((factor: number) => {
    const t = three.current;
    if (!t) return;
    const off = t.camera.position.clone().sub(t.controls.target);
    const len = THREE.MathUtils.clamp(off.length() * factor, t.controls.minDistance, t.controls.maxDistance);
    off.setLength(len);
    t.camera.position.copy(t.controls.target).add(off);
    t.needsRender = true;
  }, []);

  // ------------------------------------------------------------------ build meshes from the model
  useEffect(() => {
    const t = three.current;
    if (!t) return;

    // dispose + remove everything from the previous model (also when there is no model for
    // the selected card yet, so one card's geometry is never shown for another card)
    for (const child of [...t.modelGroup.children]) {
      t.modelGroup.remove(child);
      disposeObject(child);
    }
    if (!model) {
      t.needsRender = true;
      return;
    }
    for (const part of model.parts) {
      if (part.positions.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      const smooth = toCreasedNormals(geo, THREE.MathUtils.degToRad(38));
      geo.dispose();
      const spec = MATERIALS[part.role];
      const color = part.role === 'base'
        ? appearance.cardColor
        : part.role === 'border'
          ? appearance.borderColor
          : part.role === 'alphabet'
            ? appearance.alphabetColor
            : part.role === 'word' || part.role === 'word-outline'
              ? (part.role === 'word-outline' ? appearance.wordOutlineColor : appearance.wordColor)
              : part.role === 'pattern-outline'
                ? appearance.wordOutlineColor
                : appearance.imageColor;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: spec.roughness, metalness: 0 });
      const mesh = new THREE.Mesh(smooth, mat);
      mesh.name = part.role;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      t.modelGroup.add(mesh);
    }

    const { width: W, height: H } = model.expected;
    const zMax = model.bounds.max[2];
    t.size.set(W, H, zMax);
    t.center.set(0, 0, zMax / 2);
    t.surfaceZ = model.expected.thickness;
    t.dims = { w: W, h: H };

    // floor: subtle grid + contact shadow below the card
    for (const child of [...t.floor.children]) {
      t.floor.remove(child);
      disposeObject(child);
    }
    const span = Math.max(W, H);
    const gridSize = Math.ceil((span * 3) / 20) * 20;
    const grid = new THREE.GridHelper(gridSize, gridSize / 10, 0xc5cbd3, 0xdde1e6);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.set(0, -H / 2 - 0.2, zMax / 2);
    t.floor.add(grid);
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(gridSize, gridSize), new THREE.ShadowMaterial({ opacity: 0.16 }));
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.set(0, -H / 2 - 0.1, zMax / 2);
    shadowPlane.receiveShadow = true;
    t.floor.add(shadowPlane);

    const sc = t.keyLight.shadow.camera;
    const ext = span * 1.1;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 10;
    sc.far = span * 6;
    sc.updateProjectionMatrix();
    t.keyLight.target.position.set(0, 0, zMax / 2);
    t.keyLight.target.updateMatrixWorld();
    t.renderer.shadowMap.needsUpdate = true;

    // framing: default view for a new card, re-fit when the size changed, otherwise leave the camera alone
    const dimsKey = `${W}x${H}x${model.expected.thickness}`;
    if (lastCardKey.current !== cardKey) {
      goTo(DEFAULT_DIR, lastCardKey.current !== null);
    } else if (lastDims.current !== dimsKey) {
      fitKeepingDirection();
    }
    lastCardKey.current = cardKey;
    lastDims.current = dimsKey;
    t.needsRender = true;
  }, [model, cardKey, goTo, fitKeepingDirection, appearance]);

  // ------------------------------------------------------------------ hole placement marker
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    for (const child of [...t.marker.children]) {
      t.marker.remove(child);
      disposeObject(child);
    }
    if (!placeMode || !holeCenter || !holeCenter.enabled || !t.dims) {
      t.marker.visible = false;
      t.needsRender = true;
      return;
    }
    const r = holeCenter.diameter / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.1, r - 0.35), r + 0.35, 48), new THREE.MeshBasicMaterial({ color: 0x16a34a, side: THREE.DoubleSide, depthTest: false, transparent: true }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: 0x16a34a, transparent: true, opacity: 0.28, depthTest: false, side: THREE.DoubleSide }));
    ring.renderOrder = 10;
    disc.renderOrder = 9;
    t.marker.add(disc, ring);
    t.marker.position.set(holeCenter.x - t.dims.w / 2, t.dims.h / 2 - holeCenter.y, t.size.z + 0.1);
    t.marker.visible = true;
    t.needsRender = true;
  }, [placeMode, holeCenter, model]);

  const dims = model ? model.validation.size : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-b from-slate-100 to-slate-200" data-testid="viewer" data-building={building} data-has-model={Boolean(model)}>
      <div ref={containerRef} className={`absolute inset-0 ${placeMode ? 'cursor-crosshair' : 'cursor-grab'}`} />

      {/* top row: dimensions (left) and generation status (right); wraps instead of overlapping */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-full rounded-lg bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow-sm ring-1 ring-slate-200" data-testid="model-dimensions">
          {model && dims ? (
            <>
              <span className="font-semibold text-slate-900">
                {fmt(dims[0])} {TIMES} {fmt(dims[1])} {TIMES} {fmt(dims[2])} mm
              </span>
              <span className="ml-2 hidden text-slate-500 sm:inline">(card {fmt(model.expected.width)} {TIMES} {fmt(model.expected.height)} {TIMES} {fmt(model.expected.thickness)} mm + raised details)</span>
            </>
          ) : (
            <span>No model yet</span>
          )}
        </div>

        <div className="flex flex-col items-end gap-1" data-testid="geometry-status">
          {building ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200" data-state="building">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Generating geometry{ELLIPSIS}
            </span>
          ) : error ? (
            <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white shadow-sm" data-state="error">
              Geometry error
            </span>
          ) : stale ? (
            <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-medium text-white shadow-sm" data-state="stale">
              Preview out of date
            </span>
          ) : model ? (
            <span className="rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white shadow-sm" data-state="ready" data-build-ms={model.buildMs} data-triangles={model.validation.triangles}>
              Geometry ready {DOT} {model.validation.triangles.toLocaleString()} triangles
            </span>
          ) : null}
        </div>
      </div>
      {placeMode && (
        <div className="pointer-events-none absolute left-1/2 top-16 w-max max-w-[92%] -translate-x-1/2 rounded-full bg-green-600 px-4 py-1.5 text-center text-xs font-medium text-white shadow-lg" data-testid="place-banner">
          <Crosshair className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
          Click the card to place the hole · drag to rotate the view
        </div>
      )}

      {error && (
        <div className="absolute inset-x-3 bottom-20 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 shadow" role="alert" data-testid="geometry-error">
          <strong className="font-semibold">The 3D model could not be generated.</strong> {error}
        </div>
      )}

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center p-6" role="alert" data-testid="webgl-error">
          <div className="max-w-md rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">3D preview is not available</p>
            <p className="mt-1">This browser or device could not start WebGL ({webglError}). Try another browser or enable hardware acceleration. Editing and STL export still work because they do not need WebGL.</p>
          </div>
        </div>
      )}

      {/* bottom row: camera views (left, wraps) and zoom (right) */}
      <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
      <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Camera views">
        {[
          ['Front', () => goTo(FRONT_DIR)],
          ['Back', () => goTo(BACK_DIR)],
          ['Side', () => goTo(SIDE_DIR)],
        ].map(([label, fn]) => (
          <button key={label as string} type="button" onClick={fn as () => void} data-testid={`view-${(label as string).toLowerCase()}`} className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50">
            {label as string}
          </button>
        ))}
        <button type="button" onClick={() => goTo(DEFAULT_DIR)} data-testid="view-reset" className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50">
          Reset camera
        </button>
        <button type="button" onClick={fitKeepingDirection} data-testid="view-fit" className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-green-700">
          Fit to view
        </button>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom in" data-testid="zoom-in" className="rounded-lg bg-white p-1.5 text-slate-800 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom out" data-testid="zoom-out" className="rounded-lg bg-white p-1.5 text-slate-800 shadow-sm ring-1 ring-slate-300 hover:bg-slate-50">
          <Minus className="h-4 w-4" />
        </button>
      </div>
      </div>
    </div>
  );
}

// Written as escapes so editing tools can never corrupt them.
const TIMES = '\u00d7';
const DOT = '\u00b7';
const ELLIPSIS = '\u2026';

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}
