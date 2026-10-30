/**
 * Mesh checks on a triangle soup (x y z per vertex, 9 floats per triangle).
 *
 * What IS checked: finite coordinates, degenerate triangles, boundary (open) edges,
 * non-manifold edges, inconsistent triangle orientation, number of disconnected pieces,
 * signed volume and the bounding box.
 *
 * What is NOT checked: triangle/triangle self-intersections and wall-thickness analysis.
 * Because of that, a passing mesh is reported as "closed and manifold", never as
 * "guaranteed printable".
 */
export interface MeshValidation {
  triangles: number;
  uniqueVertices: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  size: [number, number, number];
  nonFinite: number;
  degenerate: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  components: number;
  volume: number;
  closedManifold: boolean;
  status: 'ok' | 'warning' | 'error';
  messages: string[];
}

const Q = 1e4; // weld tolerance: 0.0001 mm

export function validatePositions(positions: ArrayLike<number>): MeshValidation {
  const triCount = Math.floor(positions.length / 9);
  const messages: string[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let nonFinite = 0;

  const vertexIds = new Map<string, number>();
  const tri = new Int32Array(triCount * 3);
  let volume = 0;
  let degenerate = 0;

  const idOf = (x: number, y: number, z: number): number => {
    const key = Math.round(x * Q) + ',' + Math.round(y * Q) + ',' + Math.round(z * Q);
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertexIds.size;
      vertexIds.set(key, id);
    }
    return id;
  };

  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    let bad = false;
    for (let k = 0; k < 9; k++) {
      if (!Number.isFinite(positions[o + k])) bad = true;
    }
    if (bad) {
      nonFinite++;
      tri[t * 3] = tri[t * 3 + 1] = tri[t * 3 + 2] = -1;
      continue;
    }
    for (let v = 0; v < 3; v++) {
      const x = positions[o + v * 3];
      const y = positions[o + v * 3 + 1];
      const z = positions[o + v * 3 + 2];
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
      tri[t * 3 + v] = idOf(x, y, z);
    }
    const ax = positions[o];
    const ay = positions[o + 1];
    const az = positions[o + 2];
    const bx = positions[o + 3];
    const by = positions[o + 4];
    const bz = positions[o + 5];
    const cx = positions[o + 6];
    const cy = positions[o + 7];
    const cz = positions[o + 8];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area2 = Math.hypot(nx, ny, nz);
    const a = tri[t * 3];
    const b = tri[t * 3 + 1];
    const c = tri[t * 3 + 2];
    if (area2 < 1e-9 || a === b || b === c || a === c) degenerate++;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }

  const N = vertexIds.size || 1;
  const edges = new Map<number, number>(); // key -> forward count + 1000 * backward count
  const note = (u: number, v: number) => {
    if (u === v) return;
    const lo = u < v ? u : v;
    const hi = u < v ? v : u;
    const key = lo * N + hi;
    const add = u < v ? 1 : 1000;
    edges.set(key, (edges.get(key) ?? 0) + add);
  };
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const used = new Uint8Array(N);

  for (let t = 0; t < triCount; t++) {
    const a = tri[t * 3];
    if (a < 0) continue;
    const b = tri[t * 3 + 1];
    const c = tri[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    note(a, b);
    note(b, c);
    note(c, a);
    used[a] = used[b] = used[c] = 1;
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }

  let boundary = 0;
  let nonManifold = 0;
  let inconsistent = 0;
  edges.forEach((v) => {
    const fwd = v % 1000;
    const bwd = Math.floor(v / 1000);
    const total = fwd + bwd;
    if (total === 1) boundary++;
    else if (total > 2) nonManifold++;
    else if (fwd !== 1 || bwd !== 1) inconsistent++;
  });

  const roots = new Set<number>();
  for (let i = 0; i < N; i++) if (used[i]) roots.add(find(i));

  const size: [number, number, number] = triCount
    ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    : [0, 0, 0];

  if (triCount === 0) messages.push('The mesh is empty.');
  if (nonFinite) messages.push(`${nonFinite} triangle(s) contain non-finite coordinates.`);
  if (degenerate) messages.push(`${degenerate} degenerate (zero-area) triangle(s).`);
  if (boundary) messages.push(`${boundary} open edge(s): the surface is not closed.`);
  if (nonManifold) messages.push(`${nonManifold} non-manifold edge(s) shared by more than two triangles.`);
  if (inconsistent) messages.push(`${inconsistent} edge(s) with inconsistent triangle orientation.`);
  if (triCount && volume <= 0) messages.push('The mesh volume is not positive (inside-out or empty).');
  if (roots.size > 1) messages.push(`The model consists of ${roots.size} separate pieces.`);

  const closedManifold = triCount > 0 && boundary === 0 && nonManifold === 0 && inconsistent === 0 && nonFinite === 0;
  let status: MeshValidation['status'] = 'ok';
  if (triCount === 0 || nonFinite || boundary || nonManifold || inconsistent || volume <= 0) status = 'error';
  else if (degenerate || roots.size > 1) status = 'warning';

  return {
    triangles: triCount,
    uniqueVertices: vertexIds.size,
    boundsMin: triCount ? min : [0, 0, 0],
    boundsMax: triCount ? max : [0, 0, 0],
    size,
    nonFinite,
    degenerate,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    inconsistentEdges: inconsistent,
    components: roots.size,
    volume,
    closedManifold,
    status,
    messages,
  };
}
