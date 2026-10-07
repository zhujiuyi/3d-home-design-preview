'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {clone, normalizeProject, geometryBounds, rectSubtract, wallSegments, wallId} = require('../floorplan-core.js');

const types = ['bed', 'chair'];
const materials = ['wood', 'tile800'];
const emptyPlan = () => ({rooms:[], walls:[], windows:[], doors:[], slides:[]});
const emptyProject = () => ({version:2, name:'测试户型', floorplan:emptyPlan(), furniture:[], rooms:{}, demolished:[], measures:[]});
function sample() {
  const s = emptyProject();
  s.floorplan.rooms = [{id:'bedroom', name:'卧室', poly:[[0,0],[4000,0],[4000,3000],[0,3000]], mat:'wood', at:[2000,1500]}];
  s.floorplan.walls = [[-120,-120,4120,0,'e',{id:'wall-top',roomId:'bedroom',edge:0}],[4000,0,4120,3000,'n',{id:'wall-right',roomId:'bedroom',edge:1}]];
  s.floorplan.windows = [[800,-120,2000,0,{id:'window-top',wallId:'wall-top'}]];
  s.floorplan.doors = [{id:'door-right',wallId:'wall-right',name:'卧室门', rect:[4000,1800,4120,2700], h:[4000,1800], c:[0,1], o:[-1,0], len:900, entry:true,side:-1,hingeEnd:0}];
  s.floorplan.slides = [{id:'slide-bottom',rect:[1000,2900,2500,3000],v:false}];
  s.rooms = {bedroom:{name:'我的卧室',mat:'tile800'}};
  s.furniture = [{id:'bed-1',type:'bed',name:'床',cx:1700,cy:2000,w:1800,d:2000,rot:90,color:'#aabbcc'}];
  s.demolished = ['wall-right'];
  s.measures = [{a:{x:0,y:0},b:{x:4000,y:3000}}];
  return s;
}
const normalize = s => normalizeProject(s, sample(), types, materials);

test('v2 JSON round trip preserves geometry, openings, materials, furniture, demolition and measures', () => {
  const source = sample(), loaded = normalize(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(loaded, source);
  loaded.floorplan.rooms[0].poly[0][0] = 123;
  loaded.rooms.bedroom.name = '改名';
  assert.equal(source.floorplan.rooms[0].poly[0][0], 0);
  assert.equal(source.rooms.bedroom.name, '我的卧室');
});

test('old plans and missing full floorplan are rejected without changing input', () => {
  for (const modify of [s => { delete s.floorplan; delete s.version; }, s => { delete s.floorplan; }, s => s.version = 1]) {
    const source = sample(); modify(source);
    const before = clone(source);
    assert.throws(() => normalize(source));
    assert.deepEqual(source, before);
  }
});

test('stable wall and opening IDs survive removing another wall; obsolete index demolition is rejected', () => {
  const s = sample(); s.demolished = ['w1'];
  assert.throws(() => normalize(s), /拆墙记录/);
  s.demolished = ['wall-right'];
  s.floorplan.walls.shift(); s.floorplan.windows = [];
  const loaded = normalize(s);
  assert.deepEqual(loaded.demolished, ['wall-right']);
  assert.equal(loaded.floorplan.doors[0].wallId, 'wall-right');
  assert.equal(wallId(loaded.floorplan.walls[0], 0), 'wall-right');
  assert.equal(wallId([0,0,1000,100,'n'], 3), 'w3');
});

test('missing IDs receive initial defaults and attachment metadata is checked', () => {
  const s = sample();
  s.floorplan.walls = s.floorplan.walls.map(w => w.slice(0,5));
  s.floorplan.windows = s.floorplan.windows.map(w => w.slice(0,4));
  delete s.floorplan.doors[0].id; delete s.floorplan.doors[0].wallId;
  delete s.floorplan.slides[0].id; s.demolished = ['w1'];
  const loaded = normalize(s);
  assert.equal(loaded.floorplan.walls[0][5].id, 'w0');
  assert.equal(loaded.floorplan.windows[0][4].id, 'win0');
  assert.equal(loaded.floorplan.doors[0].id, 'd0');
  assert.equal(loaded.floorplan.slides[0].id, 's0');
  for (const mutate of [s => s.floorplan.windows[0][4].wallId = 'missing', s => s.floorplan.doors[0].wallId = 'missing', s => s.floorplan.walls[0][5].roomId = 'missing', s => s.floorplan.walls[0][5].edge = 4]) {
    const bad = sample(); mutate(bad); assert.throws(() => normalize(bad));
  }
});

test('empty projects save and load, missing room overrides default from floorplan', () => {
  assert.deepEqual(normalize(emptyProject()), emptyProject());
  const s = sample(); delete s.rooms;
  assert.deepEqual(normalize(s).rooms, {bedroom:{name:'卧室',mat:'wood'}});
  assert.deepEqual(geometryBounds(emptyPlan()), {x:-3000,y:-3000,w:6000,h:6000});
});

test('reject nonfinite, degenerate and crossing geometry without changing source', () => {
  for (const poly of [ [[0,0],[1000,0]], [[0,0],[1000,0],[2000,0]], [[0,0],[1000,1000],[0,1000],[1000,0]], [[0,0],[Infinity,0],[0,1000]], [[0,0],[1000001,0],[0,1000]], [[0,0],[1000,0],[1000,0],[0,1000]] ]) {
    const s = sample(); s.floorplan.rooms[0].poly = poly;
    assert.throws(() => normalize(s));
    assert.equal(s.floorplan.rooms[0].poly, poly);
  }
  const s = sample(); s.floorplan.walls[0] = [100,0,0,120,'n'];
  assert.throws(() => normalize(s), /矩形/);
});

test('simple concave rooms are valid', () => {
  const s = sample(); s.floorplan.rooms[0].poly = [[0,0],[4000,0],[4000,1000],[2000,1000],[2000,3000],[0,3000]];
  assert.deepEqual(normalize(s).floorplan.rooms[0].poly, s.floorplan.rooms[0].poly);
});

test('reject duplicate and unsafe IDs, unsupported furniture/materials and malicious keys', () => {
  const mutations = [
    s => s.floorplan.rooms.push(clone(s.floorplan.rooms[0])),
    s => s.furniture.push(clone(s.furniture[0])),
    s => s.floorplan.rooms[0].id = 'bad"id',
    s => s.furniture[0].id = '__proto__',
    s => s.furniture[0].type = 'unknown',
    s => s.rooms.bedroom.mat = 'unknown',
    s => s.furniture[0].color = 'red',
    s => s.furniture[0].w = 0,
    s => s.demolished = ['w900'],
    s => s.rooms.deleted = {name:'x',mat:'wood'},
    s => s.floorplan.doors[0].o = [0,-1],
    s => s.version = 99
  ];
  for (const mutate of mutations) { const s = sample(); mutate(s); assert.throws(() => normalize(s)); }
  assert.throws(() => normalize(JSON.parse('{"furniture":[],"__proto__":{"polluted":true}}')), /不允许/);
  assert.equal({}.polluted, undefined);
});

test('collection limits and malformed arrays prevent destructive imports', () => {
  const s = sample(); s.floorplan.walls = Array.from({length:2001}, () => [0,0,100,120,'n']);
  assert.throws(() => normalize(s), /2000/);
  for (const key of ['rooms','walls','windows','doors','slides']) { const bad = sample(); bad.floorplan[key] = null; assert.throws(() => normalize(bad)); }
  const bad = sample(); bad.measures = [{a:{x:NaN,y:0},b:{x:1,y:1}}];
  assert.throws(() => normalize(bad));
});

test('bounds include rotated furniture and far-away geometry with a usable empty minimum', () => {
  const plan = emptyPlan(); plan.rooms = [{poly:[[20000,30000],[26000,30000],[26000,34000],[20000,34000]]}];
  const bounds = geometryBounds(plan, [{cx:30000,cy:30000,w:1000,d:3000,rot:90}]);
  assert.equal(bounds.x, 18800);
  assert.equal(bounds.y, 28300);
  assert.equal(bounds.w, 13900);
  assert.equal(bounds.h, 6900);
});

test('wall cuts keep only nonoverlapping solid rectangles for door/window openings', () => {
  assert.deepEqual(wallSegments([0,0,4000,120,'n'], [[1000,0,1900,120],[2600,0,3400,120]]), [[0,0,1000,120],[1900,0,2600,120],[3400,0,4000,120]]);
  assert.deepEqual(wallSegments([0,0,120,4000], [{rect:[0,1000,120,1900]}]), [[0,0,120,1000],[0,1900,120,4000]]);
  assert.deepEqual(rectSubtract([0,0,100,100], [25,25,75,75]), [[0,0,25,100],[75,0,100,100],[25,0,75,25],[25,75,75,100]]);
  assert.deepEqual(rectSubtract([0,0,100,100], [-5,-5,105,105]), []);
  assert.deepEqual(rectSubtract([0,0,100,100], [100,0,120,100]), [[0,0,100,100]]);
});

test('the same pure API is available in a browser global', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'floorplan-core.js'), 'utf8'), context);
  assert.equal(typeof context.FloorplanCore.normalizeProject, 'function');
  assert.equal(typeof context.FloorplanCore.geometryBounds, 'function');
});

test('the shipped example creates a full v2 project without losing geometry or furniture', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = source.indexOf('let WALLS ='), end = source.indexOf('const STORE =');
  assert.ok(start > 0 && end > start, 'example definitions are present');
  const context = vm.createContext({FloorplanCore:require('../floorplan-core.js')});
  vm.runInContext(source.slice(start, end) + '\n globalThis.example = defaultState();', context);
  const example = JSON.parse(JSON.stringify(context.example));
  assert.equal(example.floorplan.rooms.length, 13);
  assert.equal(example.floorplan.walls.length, 48);
  assert.equal(example.floorplan.windows.length, 12);
  assert.equal(example.floorplan.doors.length, 6);
  assert.ok(example.furniture.length > 40);
  assert.equal(example.floorplan.legacyDetails, true);
  assert.deepEqual(example.demolished, []);
});
