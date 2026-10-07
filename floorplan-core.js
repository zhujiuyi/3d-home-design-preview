/* Pure project validation and geometry helpers shared by the editor and Node checks. */
(function (root) {
  'use strict';

  const MAX_ITEMS = 2000;
  const MAX_COORD = 1000000;
  const ID = /^[A-Za-z0-9_-]{1,120}$/;
  const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const WALL_TYPES = new Set(['b', 'e', 'n', 'low']);
  const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);

  function fail(path, detail) { throw new Error(`${path}: ${detail}`); }
  function object(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象');
    return value;
  }
  function list(value, path, fallback) {
    if (value === undefined && fallback !== undefined) value = fallback;
    if (!Array.isArray(value) || value.length > MAX_ITEMS) fail(path, `必须是数组，最多 ${MAX_ITEMS} 项`);
    return value;
  }
  function text(value, path, fallback) {
    if (value === undefined && fallback !== undefined) value = fallback;
    if (typeof value !== 'string' || value.length > 500) fail(path, '必须是长度不超过 500 的文本');
    return value;
  }
  function finite(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_COORD) fail(path, '坐标或数值必须有限，且不超过 1000000');
    return value;
  }
  function size(value, path) {
    finite(value, path);
    if (value <= 0) fail(path, '尺寸必须大于 0');
    return value;
  }
  function point(value, path) {
    if (!Array.isArray(value) || value.length !== 2) fail(path, '必须包含两个坐标');
    return [finite(value[0], `${path}[0]`), finite(value[1], `${path}[1]`)];
  }
  function rect(value, path) {
    if (!Array.isArray(value) || value.length !== 4) fail(path, '矩形必须包含四个坐标');
    const r = value.map((v, i) => finite(v, `${path}[${i}]`));
    if (r[2] <= r[0] || r[3] <= r[1]) fail(path, '矩形的宽和深必须大于 0');
    if (r[2] - r[0] > MAX_COORD || r[3] - r[1] > MAX_COORD) fail(path, '矩形尺寸不超过 1000000');
    return r;
  }
  function id(value, path, ids) {
    if (typeof value !== 'string' || !ID.test(value) || UNSAFE.has(value)) fail(path, 'ID 只能包含字母、数字、下划线和短横线');
    if (ids.has(value)) fail(path, 'ID 重复');
    ids.add(value);
    return value;
  }
  function knownSet(values) {
    if (values instanceof Set || Array.isArray(values)) return new Set(values);
    if (values && typeof values === 'object') return new Set(Object.keys(values));
    return new Set();
  }
  function supported(value, path, options) {
    if (typeof value !== 'string' || !options.has(value)) fail(path, '不支持的类型或材料');
    return value;
  }
  function optionalBoolean(value, path) {
    if (value !== undefined && typeof value !== 'boolean') fail(path, '必须是布尔值');
    return value;
  }
  function safeTree(value, path = '方案', ancestors = new Set(), depth = 0) {
    if (!value || typeof value !== 'object') return;
    if (depth > 30 || ancestors.has(value)) fail(path, '数据嵌套过深或循环引用');
    ancestors.add(value);
    for (const key of Object.keys(value)) {
      if (UNSAFE.has(key)) fail(`${path}.${key}`, '不允许的字段');
      safeTree(value[key], `${path}.${key}`, ancestors, depth + 1);
    }
    ancestors.delete(value);
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  function onSegment(a, b, p) {
    return Math.abs(cross(a, b, p)) < 1e-7 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  }
  function intersects(a, b, c, d) {
    const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
    return (ac * ad < 0 && ca * cb < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
  }
  function polygon(value, path) {
    const poly = list(value, path).map((p, i) => point(p, `${path}[${i}]`));
    if (poly.length < 3) fail(path, '房间至少需要三个顶点');
    let twiceArea = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (same(a, b)) fail(path, '相邻顶点不能重复');
      twiceArea += a[0] * b[1] - b[0] * a[1];
      for (let j = i + 1; j < poly.length; j++) {
        if (j === i + 1 || (i === 0 && j === poly.length - 1)) continue;
        if (intersects(a, b, poly[j], poly[(j + 1) % poly.length])) fail(path, '房间边界不能交叉或重叠');
      }
    }
    if (Math.abs(twiceArea) < 1e-7) fail(path, '房间面积必须大于 0');
    return poly;
  }
  function direction(value, path) {
    const p = point(value, path);
    if (!(Math.abs(p[0]) + Math.abs(p[1]) === 1 && (p[0] === 0 || p[1] === 0))) fail(path, '门方向必须是水平或垂直单位向量');
    return p;
  }

  function normalizeProject(input, templateState, knownFurnitureTypes, knownMaterials) {
    object(input, '方案');
    safeTree(input);
    if (input.version !== 2) fail('方案.version', '仅支持包含完整户型的第 2 版方案');
    const rawPlan = input.floorplan;
    object(rawPlan, '方案.floorplan');
    safeTree(rawPlan);
    const types = knownSet(knownFurnitureTypes), materials = knownSet(knownMaterials);
    const roomIds = new Set(), furnitureIds = new Set(), wallIds = new Set(), windowIds = new Set(), doorIds = new Set(), slideIds = new Set();
    const attachment = (value, key, path, allowed) => {
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || !allowed.has(value)) fail(`${path}.${key}`, '关联对象不存在');
      return value;
    };
    const plan = {
      rooms: list(rawPlan.rooms, '户型.rooms').map((r, i) => {
        const path = `户型.rooms[${i}]`; object(r, path);
        const out = {id:id(r.id, `${path}.id`, roomIds), name:text(r.name, `${path}.name`, '房间'), poly:polygon(r.poly, `${path}.poly`), mat:supported(r.mat, `${path}.mat`, materials)};
        if (r.at !== undefined) out.at = point(r.at, `${path}.at`);
        else out.at = out.poly.reduce((p, q) => [p[0] + q[0] / out.poly.length, p[1] + q[1] / out.poly.length], [0, 0]);
        const counted = optionalBoolean(r.counted, `${path}.counted`);
        if (counted === false) out.counted = false;
        return out;
      }),
      walls: list(rawPlan.walls, '户型.walls').map((w, i) => {
        const path = `户型.walls[${i}]`;
        if (!Array.isArray(w) || (w.length !== 5 && w.length !== 6)) fail(path, '墙体必须包含矩形、类型及可选元数据');
        const source = w[5] === undefined ? {} : object(w[5], `${path}.metadata`);
        const meta = {id:id(source.id === undefined ? 'w' + i : source.id, `${path}.id`, wallIds)};
        const roomId = attachment(source.roomId, 'roomId', path, roomIds);
        if (roomId !== undefined) meta.roomId = roomId;
        if (source.edge !== undefined) {
          if (!Number.isInteger(source.edge) || source.edge < 0 || source.edge > 3 || roomId === undefined) fail(`${path}.edge`, '房间墙边序号必须是 0 至 3，且关联房间');
          meta.edge = source.edge;
        }
        return [...rect(w.slice(0, 4), path), supported(w[4], `${path}.type`, WALL_TYPES), meta];
      }),
      windows: list(rawPlan.windows, '户型.windows').map((w, i) => {
        const path = `户型.windows[${i}]`;
        if (!Array.isArray(w) || (w.length !== 4 && w.length !== 5)) fail(path, '窗必须包含矩形及可选元数据');
        const source = w[4] === undefined ? {} : object(w[4], `${path}.metadata`);
        const meta = {id:id(source.id === undefined ? 'win' + i : source.id, `${path}.id`, windowIds)};
        const wallId = attachment(source.wallId, 'wallId', path, wallIds);
        if (wallId !== undefined) meta.wallId = wallId;
        return [...rect(w.slice(0, 4), path), meta];
      }),
      doors: list(rawPlan.doors, '户型.doors').map((d, i) => {
        const path = `户型.doors[${i}]`; object(d, path);
        const out = {id:id(d.id === undefined ? 'd' + i : d.id, `${path}.id`, doorIds), name:text(d.name, `${path}.name`, '门'), rect:rect(d.rect, `${path}.rect`), h:point(d.h, `${path}.h`), c:direction(d.c, `${path}.c`), o:direction(d.o, `${path}.o`), len:size(d.len, `${path}.len`)};
        const wallId = attachment(d.wallId, 'wallId', path, wallIds);
        if (wallId !== undefined) out.wallId = wallId;
        if (out.c[0] * out.o[0] + out.c[1] * out.o[1] !== 0) fail(path, '门的开关方向必须垂直');
        const entry = optionalBoolean(d.entry, `${path}.entry`);
        if (entry !== undefined) out.entry = entry;
        if (d.side !== undefined) {
          if (d.side !== 1 && d.side !== -1) fail(`${path}.side`, '开门方向必须是 1 或 -1');
          out.side = d.side;
        }
        if (d.hingeEnd !== undefined) {
          if (d.hingeEnd !== 0 && d.hingeEnd !== 1) fail(`${path}.hingeEnd`, '铰链端必须是 0 或 1');
          out.hingeEnd = d.hingeEnd;
        }
        return out;
      }),
      slides: list(rawPlan.slides, '户型.slides').map((s, i) => {
        const path = `户型.slides[${i}]`; object(s, path);
        if (typeof s.v !== 'boolean') fail(`${path}.v`, '推拉门方向必须是布尔值');
        const out = {id:id(s.id === undefined ? 's' + i : s.id, `${path}.id`, slideIds), rect:rect(s.rect, `${path}.rect`), v:s.v};
        const wallId = attachment(s.wallId, 'wallId', path, wallIds);
        if (wallId !== undefined) out.wallId = wallId;
        return out;
      })
    };
    const legacyDetails = optionalBoolean(rawPlan.legacyDetails, '户型.legacyDetails');
    if (legacyDetails !== undefined) plan.legacyDetails = legacyDetails;

    const roomState = input.rooms === undefined ? {} : object(input.rooms, '方案.rooms');
    for (const key of Object.keys(roomState)) if (!roomIds.has(key)) fail(`方案.rooms.${key}`, '找不到对应房间');
    const rooms = {};
    for (const r of plan.rooms) {
      const st = own(roomState, r.id) ? object(roomState[r.id], `方案.rooms.${r.id}`) : {};
      rooms[r.id] = {name:text(st.name, `方案.rooms.${r.id}.name`, r.name), mat:supported(st.mat === undefined ? r.mat : st.mat, `方案.rooms.${r.id}.mat`, materials)};
    }
    const furniture = list(input.furniture, '方案.furniture').map((f, i) => {
      const path = `方案.furniture[${i}]`; object(f, path);
      const out = {id:id(f.id, `${path}.id`, furnitureIds), type:supported(f.type, `${path}.type`, types), name:text(f.name, `${path}.name`, f.type), cx:finite(f.cx, `${path}.cx`), cy:finite(f.cy, `${path}.cy`), w:size(f.w, `${path}.w`), d:size(f.d, `${path}.d`), rot:finite(f.rot, `${path}.rot`), color:text(f.color, `${path}.color`)};
      if (!COLOR.test(out.color)) fail(`${path}.color`, '颜色必须是十六进制色值');
      out.rot = ((out.rot % 360) + 360) % 360;
      return out;
    });
    const removed = new Set();
    const demolished = list(input.demolished, '方案.demolished', []).map((w, i) => {
      if (typeof w !== 'string' || !wallIds.has(w) || removed.has(w)) fail(`方案.demolished[${i}]`, '拆墙记录无效或重复');
      removed.add(w);
      return w;
    });
    const measures = list(input.measures, '方案.measures', []).map((m, i) => {
      const path = `方案.measures[${i}]`; object(m, path);
      const measurePoint = (p, key) => { object(p, `${path}.${key}`); return {x:finite(p.x, `${path}.${key}.x`), y:finite(p.y, `${path}.${key}.y`)}; };
      return {a:measurePoint(m.a, 'a'), b:measurePoint(m.b, 'b')};
    });
    return {version:2, name:text(input.name, '方案.name', '未命名户型').trim() || '未命名户型', floorplan:plan, furniture, rooms, demolished, measures};
  }

  function geometryBounds(plan, furniture = []) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } };
    for (const r of plan.rooms || []) for (const p of r.poly) add(p[0], p[1]);
    for (const r of [...(plan.walls || []), ...(plan.windows || []), ...(plan.doors || []).map(d => d.rect), ...(plan.slides || []).map(s => s.rect)]) { add(r[0], r[1]); add(r[2], r[3]); }
    for (const f of furniture) {
      const angle = (f.rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
      const hw = (f.w * c + f.d * s) / 2, hh = (f.w * s + f.d * c) / 2;
      add(f.cx - hw, f.cy - hh); add(f.cx + hw, f.cy + hh);
    }
    if (!Number.isFinite(minX)) return {x:-3000, y:-3000, w:6000, h:6000};
    const w = Math.max(6000, maxX - minX + 2400), h = Math.max(6000, maxY - minY + 2400);
    return {x:(minX + maxX - w) / 2, y:(minY + maxY - h) / 2, w, h};
  }

  function rectSubtract(base, cut) {
    const x0 = Math.max(base[0], cut[0]), y0 = Math.max(base[1], cut[1]), x1 = Math.min(base[2], cut[2]), y1 = Math.min(base[3], cut[3]);
    if (x1 <= x0 || y1 <= y0) return [base.slice(0, 4)];
    const out = [];
    if (base[0] < x0) out.push([base[0], base[1], x0, base[3]]);
    if (x1 < base[2]) out.push([x1, base[1], base[2], base[3]]);
    if (base[1] < y0) out.push([x0, base[1], x1, y0]);
    if (y1 < base[3]) out.push([x0, y1, x1, base[3]]);
    return out;
  }
  function wallSegments(wall, openings = []) {
    return openings.reduce((pieces, opening) => pieces.flatMap(piece => rectSubtract(piece, opening.rect || opening)), [wall.slice(0, 4)]);
  }

  const wallId = (wall, index) => wall[5]?.id || 'w' + index;
  const api = {clone, normalizeProject, geometryBounds, rectSubtract, wallSegments, wallId};
  root.FloorplanCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
