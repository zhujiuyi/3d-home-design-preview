'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../floorplan-core.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
const prefixEnd = main?.indexOf('/* ======================= 几何工具');
const renderAll = main?.match(/function renderAll\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(prefixEnd > 0 && renderAll, 'actual main state/history functions can be extracted');
const projectScript = fs.readFileSync(path.join(root, 'floorplan-projects.js'), 'utf8');
const AUTO_KEY = 'huxing-project-v2';
const NAMED_KEY = 'huxing-saved-projects-v2';

class Element {
  constructor(tag = 'div') { this.tag = tag; this.dataset = {}; this.value = ''; this.children = []; this.selectors = new Map(); this.open = false; }
  appendChild(child) { this.children.push(child); return child; }
  set innerHTML(value) {
    this.markup = value;
    this.selectors.clear();
    this.loads = [...value.matchAll(/data-load="(\d+)"/g)].map(m => { const e = new Element('button'); e.dataset.load = m[1]; return e; });
  }
  get innerHTML() { return this.markup || ''; }
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element());
    return this.selectors.get(selector);
  }
  querySelectorAll(selector) { return selector === '[data-load]' ? this.loads || [] : []; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  select() {}
  click() { return this.onclick?.(); }
}

function createRuntime(initialStorage = new Map()) {
  const storage = new Map(initialStorage), elements = new Map(), created = [], downloads = [], messages = [];
  const document = {
    head:new Element('head'), body:new Element('body'),
    createElement(tag) { const el = new Element(tag); created.push(el); return el; },
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); }
  };
  const runtime = {FloorplanCore:Core, document, Blob, console,
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, String(value))},
    matchMedia:() => ({matches:false}),
    renderGrid() {}, renderRooms() {}, renderFurn() {}, renderWalls() {}, renderOpenings() {}, renderDims() {}, renderLabels() {}, renderMeasure() {}, renderSel() {}, renderPanel() {}, updateHeader() {},
    fitView() {}, is3D:() => false, setView:async () => {},
    toast:message => messages.push(message),
    esc:value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
    download:(filename, blob) => downloads.push({filename, blob}),
    PlanEditor:{active:false, cancel() {}, setActive(active) { this.active = active; }}
  };
  runtime.window = runtime;
  const context = vm.createContext(runtime);
  const run = source => vm.runInContext(source, context, {timeout:2000});
  // Execute production state/history declarations, then its actual renderAll with only UI drawing stubbed.
  run(main.slice(0, prefixEnd) + '\n' + renderAll + '\nsyncGeometry();');
  run(projectScript);
  const read = expression => JSON.parse(run(`JSON.stringify(${expression})`));
  return {context, storage, document, elements, downloads, messages, run, read,
    files:runtime.ProjectFiles,
    state:() => read('state'),
    history:() => read('({undo:undoStack,redo:redoStack})'),
    loadSaved(index = 0) { runtime.ProjectFiles.openSaved(); const dialog = created.find(e => e.tag === 'dialog'); assert.ok(dialog.open); dialog.querySelectorAll('[data-load]')[index].click(); }
  };
}

function project(name = '户型/装修 A') {
  return {
    version:2, name,
    floorplan:{
      rooms:[{id:'living-new',name:'客厅',poly:[[20000,10000],[25000,10000],[25000,14000],[20000,14000]],mat:'wood',at:[22500,12000]}],
      walls:[[19880,9880,25120,10000,'e',{id:'outer-top',roomId:'living-new',edge:0}], [25000,10000,25120,14000,'n',{id:'inner-right',roomId:'living-new',edge:1}]],
      windows:[[21500,9880,22800,10000,{id:'win-main',wallId:'outer-top'}]],
      doors:[{id:'door-main',wallId:'inner-right',name:'入户门',rect:[25000,11500,25120,12400],h:[25000,11500],c:[0,1],o:[-1,0],len:900,entry:true,side:-1,hingeEnd:0}],
      slides:[], legacyDetails:false
    },
    rooms:{'living-new':{name:'大客厅',mat:'walnut'}},
    furniture:[{id:'sofa-1',type:'sofa',name:'自定义沙发',cx:23000,cy:13200,w:2600,d:1000,rot:45,color:'#aabbcc'}],
    demolished:['inner-right'], measures:[{a:{x:20000,y:10000},b:{x:25000,y:14000}}]
  };
}

test('new blank replaces complete geometry, enables construction and can be undone/redone', async () => {
  const app = createRuntime(), before = app.state();
  await app.files.newBlank('空白项目');
  assert.deepEqual(app.state(), {version:2,name:'空白项目',floorplan:{rooms:[],walls:[],windows:[],doors:[],slides:[],legacyDetails:false},furniture:[],rooms:{},demolished:[],measures:[]});
  assert.equal(app.context.PlanEditor.active, true);
  assert.equal(app.run('ui.layers.grid'), true);
  assert.deepEqual(app.read('BOUNDS'), {x:-3000,y:-3000,w:6000,h:6000});
  app.run('undo()');
  assert.deepEqual(app.state(), before);
  app.run('redo()');
  assert.equal(app.state().floorplan.rooms.length, 0);
  assert.equal(app.state().name, '空白项目');
  assert.equal(app.run('ROOMS === state.floorplan.rooms && WALLS === state.floorplan.walls && WINS === state.floorplan.windows && DOORS === state.floorplan.doors && SLIDES === state.floorplan.slides'), true);
});

test('export/import round trip restores the full actual project and a new browser session reloads autosave', async () => {
  const app = createRuntime(), expected = project();
  assert.equal(app.files.importJSON(JSON.stringify(expected)), true);
  assert.deepEqual(app.state(), expected);
  assert.deepEqual(JSON.parse(app.storage.get(AUTO_KEY)), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(app.files.exportJSON())), expected);
  assert.equal(app.downloads[0].filename, '户型_装修 A.json');
  const json = await app.downloads[0].blob.text();
  await app.files.newBlank('暂存空白');
  assert.equal(app.files.importJSON(json), true);
  assert.deepEqual(app.state(), expected);
  const reloaded = createRuntime(app.storage);
  assert.deepEqual(reloaded.state(), expected);
  assert.deepEqual(reloaded.read('BOUNDS'), Core.geometryBounds(expected.floorplan, expected.furniture));
});

test('invalid imports keep active geometry, selections, undo/redo history and persisted snapshot untouched', () => {
  const app = createRuntime();
  app.files.importJSON(JSON.stringify(project()));
  app.files.importJSON(JSON.stringify(project('第二版')));
  app.run("undo();ui.sel={kind:'room',id:'living-new'};");
  const state = app.state(), history = app.history(), selected = app.read('ui.sel'), saved = app.storage.get(AUTO_KEY);
  const invalidGeometry = project(); invalidGeometry.floorplan.rooms[0].poly = [[0,0],[4000,4000],[0,4000],[4000,0]];
  const unsafeID = project(); unsafeID.furniture[0].id = '<script>';
  for (const text of ['not json', JSON.stringify({furniture:[]}), JSON.stringify(invalidGeometry), JSON.stringify(unsafeID)]) {
    assert.equal(app.files.importJSON(text), false);
    assert.deepEqual(app.state(), state);
    assert.deepEqual(app.history(), history);
    assert.deepEqual(app.read('ui.sel'), selected);
    assert.equal(app.storage.get(AUTO_KEY), saved);
  }
});

test('geometry edits update actual aliases and bounds through mutate, undo and redo', () => {
  const app = createRuntime(); app.files.importJSON(JSON.stringify(project()));
  const before = app.state(), oldBounds = app.read('BOUNDS');
  app.run(`mutate(()=>{
    state.floorplan.rooms[0].poly=state.floorplan.rooms[0].poly.map(([x,y])=>[x+20000,y+20000]);
    state.floorplan.rooms[0].at=[42500,32000];
    state.floorplan.walls.push([40000,30000,40120,34000,'n',{id:'new-partition'}]);
  });`);
  const changed = app.state();
  assert.equal(app.run('ROOMS[0].poly[0][0]'), 40000);
  assert.equal(app.run('WALLS.length'), 3);
  assert.notDeepEqual(app.read('BOUNDS'), oldBounds);
  assert.deepEqual(JSON.parse(app.storage.get(AUTO_KEY)), changed);
  app.run('undo()'); assert.deepEqual(app.state(), before); assert.deepEqual(app.read('BOUNDS'), oldBounds);
  app.run('redo()'); assert.deepEqual(app.state(), changed);
  assert.equal(app.run('ROOMS===state.floorplan.rooms && WALLS===state.floorplan.walls'), true);
  assert.deepEqual(app.read('BOUNDS'), Core.geometryBounds(changed.floorplan, changed.furniture));
});

test('commit rejects an invalid authored edit and restores geometry, history, storage and aliases', () => {
  const app = createRuntime();
  app.files.importJSON(JSON.stringify(project()));
  app.files.importJSON(JSON.stringify(project('下一版')));
  app.run("undo();ui.sel={kind:'room',id:'living-new'};");
  const before = app.state(), history = app.history(), bounds = app.read('BOUNDS'), saved = app.storage.get(AUTO_KEY);
  const accepted = app.run(`(() => {
    const before = snap();
    state.floorplan.rooms[0].poly = [[0,0],[4000,4000],[0,4000],[4000,0]];
    syncGeometry();
    return commit(before);
  })()`);
  assert.equal(accepted, false);
  assert.deepEqual(app.state(), before);
  assert.deepEqual(app.history(), history);
  assert.deepEqual(app.read('BOUNDS'), bounds);
  assert.equal(app.storage.get(AUTO_KEY), saved);
  assert.deepEqual(app.read('ui.sel'), {kind:'room',id:'living-new'});
  assert.equal(app.run('ROOMS===state.floorplan.rooms && WALLS===state.floorplan.walls && WINS===state.floorplan.windows && DOORS===state.floorplan.doors && SLIDES===state.floorplan.slides'), true);
  assert.match(app.messages.at(-1), /修改超出有效范围/);
  app.run('redo()');
  assert.equal(app.state().name, '下一版');
});

test('named local save/load restores exact snapshots and same-name saves replace only that record', async () => {
  const app = createRuntime(), original = project('方案 A');
  app.files.importJSON(JSON.stringify(original));
  assert.ok(app.files.saveLocal());
  const second = project('方案 B'); second.furniture[0].cx += 1000;
  app.files.importJSON(JSON.stringify(second)); app.files.saveLocal();
  const revised = project('方案 A'); revised.furniture[0].color = '#123456'; revised.rooms['living-new'].mat = 'tile600';
  app.files.importJSON(JSON.stringify(revised)); app.files.saveLocal();
  const records = JSON.parse(app.storage.get(NAMED_KEY));
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].project, revised); assert.deepEqual(records[1].project, second);
  await app.files.newBlank('空白');
  app.loadSaved(0); assert.deepEqual(app.state(), revised);
  app.run('undo()'); assert.equal(app.state().floorplan.rooms.length, 0);
  app.run('redo()'); assert.deepEqual(app.state(), revised);
});

test('invalid named snapshot does not overwrite current project or history', () => {
  const app = createRuntime(); app.files.importJSON(JSON.stringify(project()));
  const state = app.state(), history = app.history(), saved = app.storage.get(AUTO_KEY);
  app.storage.set(NAMED_KEY, JSON.stringify([{name:'无效',updatedAt:'2026-10-08T00:00:00Z',project:{version:2,furniture:[]}}]));
  app.loadSaved(0);
  assert.deepEqual(app.state(), state); assert.deepEqual(app.history(), history);
  assert.equal(app.storage.get(AUTO_KEY), saved);
});

test('corrupt autosave is retained while startup presents a usable sample and warning', () => {
  const app = createRuntime(new Map([[AUTO_KEY, '{broken json']]));
  assert.equal(app.state().name, '示例户型');
  assert.equal(app.state().version, 2);
  assert.equal(app.storage.get(AUTO_KEY), '{broken json');
  assert.ok(app.run('loadWarning.length') > 0);
});
