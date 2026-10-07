/* Drag-based floor plan authoring. Units are millimetres; no build step is needed. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const names = {
    select:['选择 / 移动','Select / Move'], room:['房间','Room'], wall:['墙体','Wall'],
    door:['平开门','Door'], window:['窗户','Window'], slide:['推拉门','Sliding door']
  };
  let active = false, tool = 'room', gesture = null;
  const settings = {grid:true, step:100, thickness:240, wallType:'e', opening:900};
  const localId = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  const clone = value => JSON.parse(JSON.stringify(value));
  const plan = () => state.floorplan;
  const wid = (w,i) => window.FloorplanCore?.wallId(w,i) || w[5]?.id || 'w'+i;
  const walls = () => plan()?.walls || [];
  const findWall = id => walls().find((w,i) => wid(w,i) === id);
  const vertical = r => r[3]-r[1] > r[2]-r[0];
  const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
  const round = n => Math.round(n);
  const q = n => settings.grid ? Math.round(n/settings.step)*settings.step : Math.round(n);
  const roomBounds = r => [Math.min(...r.poly.map(p=>p[0])),Math.min(...r.poly.map(p=>p[1])),Math.max(...r.poly.map(p=>p[0])),Math.max(...r.poly.map(p=>p[1]))];
  const rectPoly = r => [[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]];
  const ownWalls = id => walls().filter(w => w[5]?.roomId === id);
  const structuralChange = () => { plan().legacyDetails = false; };
  function resolve(sel = ui.sel){
    if (!sel || !plan()) return null;
    if (sel.kind === 'wall') return findWall(sel.id);
    if (sel.kind === 'window') return plan().windows.find(w => w[4]?.id === sel.id);
    const list = {room:'rooms',door:'doors',slide:'slides'}[sel.kind];
    return list ? plan()[list].find(item => item.id === sel.id) : null;
  }
  function selectedRect(sel = ui.sel){
    const item = resolve(sel); if (!item) return null;
    return sel.kind === 'room' ? roomBounds(item) : ['wall','window'].includes(sel.kind) ? item.slice(0,4) : item.rect;
  }
  function snapPointEditor(p, excludedRoom){
    const out = {x:q(p.x),y:q(p.y)}, tol = 7/view.s;
    let bx=tol, by=tol;
    if (!settings.grid) return out;
    for (const w of walls()){
      if (excludedRoom && w[5]?.roomId === excludedRoom) continue;
      for (const x of [w[0],w[2]]) if (Math.abs(p.x-x)<bx){ bx=Math.abs(p.x-x); out.x=x; }
      for (const y of [w[1],w[3]]) if (Math.abs(p.y-y)<by){ by=Math.abs(p.y-y); out.y=y; }
    }
    return out;
  }
  function snapWalls(excludedId,excludedRoom){
    return walls().filter((w,i)=>wid(w,i)!==excludedId && !state.demolished.includes(wid(w,i)) && (!excludedRoom || w[5]?.roomId!==excludedRoom));
  }
  const wallDistance=(p,w)=>Math.hypot(Math.max(w[0]-p.x,0,p.x-w[2]),Math.max(w[1]-p.y,0,p.y-w[3]));
  // Wall input describes a centre line; magnets operate on the resulting solid edges.
  // At corners overlap the host thickness so both visible outer faces stay flush.
  function wallAnchors(p,other,axis,t,hosts){
    const cross=1-axis, point=[p.x,p.y], opposite=[other.x,other.y], tol=10/view.s;
    const candidates=[];
    for(const w of hosts){
      const distance=wallDistance(p,w);if(distance>tol)continue;
      const parallel=(vertical(w)?1:0)===axis;
      let centre,along=null;
      if(parallel){
        const bands=[w[cross]+t/2,w[cross+2]-t/2];
        centre=bands.reduce((best,value)=>Math.abs(value-point[cross])<Math.abs(best-point[cross])?value:best);
        const ends=[w[axis],w[axis+2]],nearest=ends.reduce((best,value)=>Math.abs(value-point[axis])<Math.abs(best-point[axis])?value:best);
        if(Math.abs(nearest-point[axis])<=tol)along=nearest;
      }else{
        const lo=w[cross],hi=w[cross+2];
        if(point[cross]<=lo+tol)centre=lo+t/2;
        else if(point[cross]>=hi-tol)centre=hi-t/2;
        else centre=hi-lo>=t?clamp(q(point[cross]),lo+t/2,hi-t/2):(lo+hi)/2;
        along=opposite[axis]>=point[axis]?w[axis]:w[axis+2];
      }
      candidates.push({centre,along,parallel,wall:w,cost:distance+Math.abs(centre-point[cross])*.1});
    }
    return candidates.sort((a,b)=>a.cost-b.cost);
  }
  function wallDraft(a,b,t,enabled){
    const axis=Math.abs(b.y-a.y)>Math.abs(b.x-a.x)?1:0,cross=1-axis;
    const first=[a.x,a.y],last=[b.x,b.y];
    let ends=[enabled?q(first[axis]):round(first[axis]),enabled?q(last[axis]):round(last[axis])];
    let centre=enabled?q(first[cross]):round(first[cross]);
    const points=[];
    if(enabled){
      const hosts=snapWalls(),anchors=[wallAnchors(a,b,axis,t,hosts),wallAnchors(b,a,axis,t,hosts)];
      const best=anchors.flat().sort((a,b)=>a.cost-b.cost)[0];
      if(best)centre=best.centre;
      anchors.forEach((options,i)=>{
        const anchor=options.find(candidate=>candidate.along!==null && (candidate.parallel?Math.abs(candidate.centre-centre)<1e-6:centre+t/2>=candidate.wall[cross] && centre-t/2<=candidate.wall[cross+2]));
        if(anchor){ends[i]=anchor.along;points.push(axis?{x:centre,y:ends[i]}:{x:ends[i],y:centre});}
      });
      if(best && !points.length)points.push(axis?{x:centre,y:ends[0]}:{x:ends[0],y:centre});
    }
    const lo=Math.min(...ends),hi=Math.max(...ends);
    return {rect:axis?[centre-t/2,lo,centre+t/2,hi]:[lo,centre-t/2,hi,centre+t/2],points};
  }
  function wallMoveSnap(r,fallback,excludedId,excludedRoom,enabled,onlyAxis){
    const points=[];if(!enabled)return {rect:fallback,points};
    const tol=10/view.s,deltas=[fallback[0]-r[0],fallback[1]-r[1]],best=[tol,tol],hosts=snapWalls(excludedId,excludedRoom);
    for(const w of hosts)for(const axis of [0,1]){
      if(onlyAxis!==undefined && onlyAxis!==axis)continue;
      const cross=1-axis;
      if(r[cross+2]<w[cross]-tol || r[cross]>w[cross+2]+tol)continue;
      const pairs=[];
      for(const from of [r[axis],r[axis+2]])for(const to of [w[axis],w[axis+2]])pairs.push([from,to]);
      if(vertical(r)===vertical(w) && axis===(vertical(r)?0:1))pairs.push([(r[axis]+r[axis+2])/2,(w[axis]+w[axis+2])/2]);
      for(const [from,to] of pairs){const delta=to-from;if(Math.abs(delta)<best[axis]){best[axis]=Math.abs(delta);deltas[axis]=delta;}}
    }
    const rect=[r[0]+deltas[0],r[1]+deltas[1],r[2]+deltas[0],r[3]+deltas[1]];
    if(best[0]<tol)points.push({x:rect[0],y:(rect[1]+rect[3])/2});
    if(best[1]<tol)points.push({x:(rect[0]+rect[2])/2,y:rect[1]});
    return {rect,points};
  }
  function wallEndSnap(r,index,raw,excludedId,excludedRoom,enabled){
    const axis=vertical(r)?1:0,cross=1-axis,centre=(r[cross]+r[cross+2])/2;
    const coordinate=enabled?q(axis?raw.y:raw.x):round(axis?raw.y:raw.x),opposite=index<2?index+2:index-2;
    const pointerCoordinate=axis?raw.y:raw.x;
    const p=axis?{x:centre,y:pointerCoordinate}:{x:pointerCoordinate,y:centre},other=axis?{x:centre,y:r[opposite]}:{x:r[opposite],y:centre};
    const anchor=enabled?wallAnchors(p,other,axis,r[cross+2]-r[cross],snapWalls(excludedId,excludedRoom)).find(a=>a.along!==null && centre>=a.wall[cross]-10/view.s && centre<=a.wall[cross+2]+10/view.s):null;
    const value=anchor?anchor.along:coordinate,rect=r.slice();
    rect[index]=index<2?Math.min(value,r[opposite]-300):Math.max(value,r[opposite]+300);
    return {rect,points:anchor?[axis?{x:centre,y:rect[index]}:{x:rect[index],y:centre}]:[]};
  }
  function nearestWall(p, maxDistance = 22/view.s){
    let best = null, distance = maxDistance;
    walls().forEach((w,i) => {
      if (state.demolished.includes(wid(w,i))) return;
      const v=vertical(w), x=v?(w[0]+w[2])/2:clamp(p.x,w[0],w[2]), y=v?clamp(p.y,w[1],w[3]):(w[1]+w[3])/2;
      const d=Math.hypot(p.x-x,p.y-y);
      if (d<=distance){ best={wall:w,id:wid(w,i),v,coordinate:v?y:x}; distance=d; }
    });
    return best;
  }
  function openingsOnWall(id){
    const p=plan();
    return [...p.windows.filter(w=>w[4]?.wallId===id).map(item=>({kind:'window',item})),
      ...p.doors.filter(d=>d.wallId===id).map(item=>({kind:'door',item})),
      ...p.slides.filter(d=>d.wallId===id).map(item=>({kind:'slide',item}))];
  }
  function doorOptions(d){
    const v=vertical(d.rect), axis=v?1:0;
    if(d.side!==1 && d.side!==-1)d.side=(v?d.o?.[0]:d.o?.[1])===-1?-1:1;
    if(d.hingeEnd!==0 && d.hingeEnd!==1)d.hingeEnd=d.h && Math.abs(d.h[axis]-d.rect[axis+2])<Math.abs(d.h[axis]-d.rect[axis])?1:0;
  }
  function poseDoor(d){
    doorOptions(d);
    const [x0,y0,x1,y1]=d.rect, v=vertical(d.rect), end=d.hingeEnd === 1, side=d.side === -1 ? -1 : 1;
    d.len=v?y1-y0:x1-x0;
    d.h=v?[side>0?x1:x0,end?y1:y0]:[end?x1:x0,side>0?y1:y0];
    d.c=v?[0,end?-1:1]:[end?-1:1,0];
    d.o=v?[side,0]:[0,side];
  }
  function placeOpening(kind,item,wall,center,length){
    if(kind==='door')doorOptions(item);
    const v=vertical(wall), start=v?wall[1]:wall[0], end=v?wall[3]:wall[2];
    length=clamp(round(length),100,end-start);
    center=clamp(round(center),start+length/2,end-length/2);
    const r=v?[wall[0],center-length/2,wall[2],center+length/2]:[center-length/2,wall[1],center+length/2,wall[3]];
    if (kind==='window') item.splice(0,4,...r);
    else { item.rect=r; if (kind==='door') poseDoor(item); else item.v=v; }
  }
  function openingRect(kind,item){ return kind==='window'?item:item.rect; }
  function moveHostedOpenings(id,oldWall,newWall){
    const oldV=vertical(oldWall), newV=vertical(newWall), oldStart=oldV?oldWall[1]:oldWall[0], oldLength=oldV?oldWall[3]-oldWall[1]:oldWall[2]-oldWall[0];
    openingsOnWall(id).forEach(({kind,item}) => {
      const r=openingRect(kind,item), center=oldV?(r[1]+r[3])/2:(r[0]+r[2])/2, length=oldV?r[3]-r[1]:r[2]-r[0];
      const start=newV?newWall[1]:newWall[0], span=newV?newWall[3]-newWall[1]:newWall[2]-newWall[0];
      placeOpening(kind,item,newWall,start+(center-oldStart)/Math.max(1,oldLength)*span,length);
    });
  }
  function perimeter(rect,t,edge){
    const [x0,y0,x1,y1]=rect;
    return [[x0-t,y0-t,x1+t,y0],[x1,y0,x1+t,y1],[x0-t,y1,x1+t,y1+t],[x0-t,y0,x0,y1]][edge];
  }
  function transformRoom(room,newRect,moveContents = false){
    const old=roomBounds(room), ow=old[2]-old[0], oh=old[3]-old[1];
    const oldPoly=room.poly.map(p=>p.slice());
    const nw=newRect[2]-newRect[0], nh=newRect[3]-newRect[1], dx=newRect[0]-old[0], dy=newRect[1]-old[1];
    const transform = ([x,y]) => [round(newRect[0]+(x-old[0])/Math.max(1,ow)*nw),round(newRect[1]+(y-old[1])/Math.max(1,oh)*nh)];
    room.poly=room.poly.map(transform); room.at=room.at?transform(room.at):[(newRect[0]+newRect[2])/2,(newRect[1]+newRect[3])/2];
    for (const w of ownWalls(room.id)){
      const original=w.slice(0,4), thickness=vertical(w)?w[2]-w[0]:w[3]-w[1], edge=w[5].edge;
      if (Number.isInteger(edge) && edge>=0 && edge<=3) w.splice(0,4,...perimeter(newRect,thickness,edge));
      else { const a=transform([w[0],w[1]]), b=transform([w[2],w[3]]); w.splice(0,4,...a,...b); }
      moveHostedOpenings(w[5].id,original,w);
    }
    if (moveContents && Math.abs(nw-ow)<1 && Math.abs(nh-oh)<1){
      state.furniture.forEach(f => { if (insideRoom(f.cx,f.cy,oldPoly)){ f.cx+=dx; f.cy+=dy; } });
    }
    structuralChange();
  }
  const insideRoom = (x,y,poly) => {
    let inside=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j];
      if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside;
  };
  function changeWall(w,r){
    const old=w.slice(0,4), meta=w[5], room=meta?.roomId?plan().rooms.find(r=>r.id===meta.roomId):null;
    if (room && Number.isInteger(meta.edge)){
      const b=roomBounds(room), t=vertical(w)?w[2]-w[0]:w[3]-w[1];
      if (meta.edge===0){ b[0]=r[0]+t; b[2]=r[2]-t; b[1]=r[3]; }
      if (meta.edge===1){ b[1]=r[1]; b[3]=r[3]; b[2]=r[0]; }
      if (meta.edge===2){ b[0]=r[0]+t; b[2]=r[2]-t; b[3]=r[1]; }
      if (meta.edge===3){ b[1]=r[1]; b[3]=r[3]; b[0]=r[2]; }
      if (b[2]-b[0]>=300 && b[3]-b[1]>=300) transformRoom(room,b);
      return;
    }
    w.splice(0,4,...r.map(round)); moveHostedOpenings(wid(w,walls().indexOf(w)),old,w); structuralChange();
  }
  function setWallThickness(w,t){
    t=clamp(round(t),50,1000);
    const old=w.slice(0,4), room=w[5]?.roomId?plan().rooms.find(r=>r.id===w[5].roomId):null;
    if (room && Number.isInteger(w[5].edge)) w.splice(0,4,...perimeter(roomBounds(room),t,w[5].edge));
    else if (vertical(w)) w[2]=w[0]+t; else w[3]=w[1]+t;
    moveHostedOpenings(wid(w,walls().indexOf(w)),old,w); structuralChange();
  }
  function addRoom(rect){
    const id=localId('room-'), name=tr('房间','Room')+' '+(plan().rooms.length+1);
    const room={id,name,poly:rectPoly(rect),mat:'wood',at:[(rect[0]+rect[2])/2,(rect[1]+rect[3])/2]};
    plan().rooms.push(room); state.rooms[id]={name,mat:'wood'};
    for (let edge=0;edge<4;edge++) plan().walls.push([...perimeter(rect,settings.thickness,edge),settings.wallType,{id:localId('wall-'),roomId:id,edge}]);
    structuralChange(); return {kind:'room',id};
  }
  function addWall(rect){
    const id=localId('wall-'); plan().walls.push([...rect,settings.wallType,{id}]); structuralChange(); return {kind:'wall',id};
  }
  function addOpening(kind,host,center,length){
    const id=localId(kind+'-'); let item;
    if (kind==='window'){ item=[0,0,0,0,{id,wallId:host.id}]; plan().windows.push(item); }
    else if (kind==='door'){ item={id,name:tr('房门','Door'),rect:[0,0,0,0],h:[0,0],c:[1,0],o:[0,1],len:length,side:1,hingeEnd:0,wallId:host.id}; plan().doors.push(item); }
    else { item={id,rect:[0,0,0,0],v:host.v,wallId:host.id}; plan().slides.push(item); }
    placeOpening(kind,item,host.wall,center,length); structuralChange(); return {kind,id};
  }
  function removeWallIds(ids){
    const p=plan(); p.walls=p.walls.filter((w,i)=>!ids.has(wid(w,i)));
    p.windows=p.windows.filter(w=>!ids.has(w[4]?.wallId));
    p.doors=p.doors.filter(d=>!ids.has(d.wallId)); p.slides=p.slides.filter(d=>!ids.has(d.wallId));
    state.demolished=state.demolished.filter(id=>!ids.has(id));
  }
  function deleteSelected(){
    const sel=ui.sel; if (!resolve(sel)) return;
    mutate(() => {
      if (sel.kind==='room'){
        removeWallIds(new Set(ownWalls(sel.id).map((w)=>wid(w,walls().indexOf(w)))));
        plan().rooms=plan().rooms.filter(r=>r.id!==sel.id); delete state.rooms[sel.id];
      } else if (sel.kind==='wall') removeWallIds(new Set([sel.id]));
      else if (sel.kind==='window') plan().windows=plan().windows.filter(w=>w[4]?.id!==sel.id);
      else { const list=sel.kind==='door'?'doors':'slides'; plan()[list]=plan()[list].filter(d=>d.id!==sel.id); }
      ui.sel=null; structuralChange();
    });
  }

  const style=document.createElement('style');
  style.textContent=`
    #planEditToggle.on{background:#2f5d62;color:#fff}
    #planEditorTools{margin:12px;padding:12px;background:#eff5f3;border:1px solid #c8d8d3;border-radius:10px}
    #planEditorTools h4{margin:0 0 8px;color:#2f5d62;font-size:13px}
    .pe-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
    .pe-tools .btn{border:1px solid #c5d4cf;background:#fff;padding:8px 3px;font-size:12px}
    .pe-tools .btn.on{background:#2f5d62;color:white;border-color:#2f5d62}
    .pe-help{font-size:11px;line-height:1.65;color:#596960;margin:8px 0}
    .pe-options{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
    .pe-options label{font-size:11px;color:#596960;display:block}
    .pe-options input,.pe-options select{width:100%;min-width:0;padding:5px;margin-top:3px;border:1px solid #c5d4cf;border-radius:5px;background:white;font:inherit;color:#292a27}
    .pe-check{display:flex;gap:6px;align-items:center;font-size:11px;margin:10px 0 0}
    .pe-check input{accent-color:#2f5d62}
    #planEditorTools .pe-exit{width:100%;margin-top:10px;background:#fff;border:1px solid #c5d4cf}
    #plan.plan-building{cursor:crosshair} #plan.plan-building.pe-select{cursor:default}
    #gPlanEdit [data-plan-handle]{cursor:nwse-resize} #gPlanEdit [data-plan-kind]{cursor:move}
    #panel .pe-note{font-size:11px;line-height:1.7;color:#7b7366;margin-top:8px}
    #panel .pe-panel>label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted);margin:10px 0}
    #panel .form-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin:10px 0}
    #panel .form-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted);min-width:0}
    #panel .pe-panel input:not([type=checkbox]),#panel .pe-panel select{border:1px solid var(--line);border-radius:6px;padding:6px 7px;background:#fff;width:100%;min-width:0;font:inherit;color:var(--ink)}
    #panel .pe-panel>label.pe-check{flex-direction:row;align-items:center;gap:6px}
    #panel .pe-panel input[type=checkbox]{width:auto;flex:0 0 auto}
    #planEditorShowTools{display:none}
    @media(max-width:1100px){#planEditorShowTools:not([hidden]){display:inline-flex}}
    @media(pointer:coarse){#panel .pe-panel input:not([type=checkbox]),#panel .pe-panel select{font-size:16px;padding:8px 9px}}
  `;
  document.head.append(style);
  const toggle=document.createElement('button'); toggle.id='planEditToggle'; toggle.className='btn'; toggle.type='button';
  $('#tools').append(toggle);
  const showTools=document.createElement('button');showTools.id='planEditorShowTools';showTools.className='btn';showTools.type='button';showTools.hidden=true;
  $('#tools').append(showTools);showTools.onclick=()=>drawer('lib',true);
  const toolbox=document.createElement('div'); toolbox.id='planEditorTools'; toolbox.className='only2d'; toolbox.hidden=true;
  $('aside.lib').insertBefore(toolbox,$('#lib'));
  const overlay=document.createElementNS(NS,'g'); overlay.id='gPlanEdit'; svg.append(overlay);

  function hint(){
    const hints={
      select:tr('拖动房间、墙体、门窗移动；拖动蓝色手柄改尺寸。空白处拖动画面。','Drag rooms, walls and openings to move; drag blue handles to resize. Drag empty space to pan.'),
      room:tr('在空白区域按住拖拽绘制房间，四周自动生成墙体。靠近已有墙边可吸附拼接。','Drag across empty space to draw a room with four walls. Snap to existing wall edges to join rooms.'),
      wall:tr('按住拖拽绘制墙体，自动锁定水平或垂直；靠近墙角、墙边自动对齐连接，Shift 临时关闭吸附。','Drag to draw a horizontal or vertical wall. Corners and edges snap together; hold Shift to disable snapping.'),
      door:tr('在墙上沿墙拖拽放置平开门；点一下按默认宽度放置。','Drag along a wall to place a door; click for the default width.'),
      window:tr('在墙上沿墙拖拽放置窗户；点一下按默认宽度放置。','Drag along a wall to place a window; click for the default width.'),
      slide:tr('在墙上沿墙拖拽放置推拉门；点一下按默认宽度放置。','Drag along a wall to place a sliding door; click for the default width.')
    }; return hints[tool];
  }
  function updateHint(){
    if (!active || is3D()) return;
    $('#modehint').textContent=hint(); $('#modehint').classList.add('show');
    $('#tip').textContent=tr('户型搭建 · 滚轮缩放 · Esc 取消 · Ctrl+Z 撤销','Build plan · Wheel: zoom · Esc: cancel · Ctrl+Z: undo');
  }
  function wallTypeOptions(value){
    return [['e','外墙','Exterior'],['n','非承重墙','Partition'],['b','承重墙','Bearing'],['low','矮墙','Low wall']].map(([v,z,e])=>`<option value="${v}" ${value===v?'selected':''}>${tr(z,e)}</option>`).join('');
  }
  function relang(){
    toggle.textContent=tr('户型搭建','Build plan'); toggle.title=tr('绘制、移动与修改房间墙体门窗','Draw and edit rooms, walls, doors and windows');
    showTools.textContent=tr('搭建工具','Build tools');
    toolbox.innerHTML=`<h4>${tr('户型搭建','Build floor plan')}</h4><div class="pe-tools">${Object.entries(names).map(([key,label])=>`<button type="button" class="btn ${tool===key?'on':''}" data-plan-tool="${key}">${tr(...label)}</button>`).join('')}</div>
      <div class="pe-help">${hint()}</div><div class="pe-options">
        <label>${tr('墙厚 mm','Wall thickness mm')}<input id="peThickness" type="number" min="50" max="1000" step="10" value="${settings.thickness}"></label>
        <label>${tr('新墙类型','New wall type')}<select id="peWallType">${wallTypeOptions(settings.wallType)}</select></label>
        <label>${tr('门窗默认宽 mm','Opening width mm')}<input id="peOpening" type="number" min="100" step="50" value="${settings.opening}"></label>
        <label>${tr('吸附网格 mm','Snap grid mm')}<select id="peStep">${[50,100,200].map(n=>`<option ${settings.step===n?'selected':''}>${n}</option>`).join('')}</select></label>
      </div><label class="pe-check"><input id="peSnap" type="checkbox" ${settings.grid?'checked':''}>${tr('网格与墙边吸附（按 Shift 临时关闭）','Snap to grid and wall edges (Shift disables temporarily)')}</label>
      <button class="btn pe-exit" id="peExit">${tr('完成搭建 · 布置家具','Finish building · Furnish')}</button>`;
    toolbox.querySelectorAll('[data-plan-tool]').forEach(b=>b.onclick=()=>setEditorTool(b.dataset.planTool));
    $('#peThickness').onchange=e=>{ settings.thickness=clamp(round(+e.target.value||240),50,1000); e.target.value=settings.thickness; };
    $('#peWallType').onchange=e=>settings.wallType=e.target.value;
    $('#peOpening').onchange=e=>{ settings.opening=clamp(round(+e.target.value||900),100,20000); e.target.value=settings.opening; };
    $('#peStep').onchange=e=>settings.step=+e.target.value;
    $('#peSnap').onchange=e=>settings.grid=e.target.checked;
    $('#peExit').onclick=()=>setActive(false);
    updateHint();
  }
  function setEditorTool(next){
    if (!names[next]) return; cancel(); tool=next; relang();
    svg.classList.toggle('pe-select',next==='select'); renderPanel(); renderOverlay();
  }
  function setActive(on){
    cancel(); active=!!on;
    if (active){ setTool('select'); active=true; ui.mA=ui.mCur=null; }
    toggle.classList.toggle('on',active); toggle.setAttribute('aria-pressed',String(active)); toolbox.hidden=!active;showTools.hidden=!active;
    svg.classList.toggle('plan-building',active); svg.classList.toggle('pe-select',active&&tool==='select');
    if (!active){ overlay.innerHTML=''; syncModeHint(); }
    relang(); renderAll();
  }
  toggle.onclick=()=>setActive(!active);
  $('#tools').querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',e=>{
    if(!active)return;
    if(b.dataset.tool==='select'){capture(e);setEditorTool('select');}
    else setActive(false);
  },true));
  // Beginning a furniture drag switches straight back to furnishing mode.
  $('#lib').addEventListener('pointerdown',()=>{ if(active)setActive(false); },true);

  const field = (id,label,value,min,step=10) => `<label>${label}<input id="${id}" type="number" value="${round(value)}" ${min===undefined?'':`min="${min}"`} step="${step}"></label>`;
  function renderPanel(){
    if (!active || is3D()) return false;
    const sel=ui.sel, item=resolve(sel), r=item?selectedRect(sel):null, p=$('#panel');
    if (!item){
      p.innerHTML=`<section><h3>${tr('搭建自己的户型','Build your floor plan')}</h3><div class="pe-note">${hint()}<br>${tr('房间尺寸按墙内净尺寸计算，单位为毫米。选中后可输入精确尺寸，所有修改支持撤销。','Room sizes are measured inside walls, in millimetres. Select an element to enter exact dimensions; all changes support undo.')}</div>
      <div class="stats"><div><small>${tr('房间','Rooms')}</small><span class="big">${plan().rooms.length}</span></div><div><small>${tr('墙体','Walls')}</small><span class="big">${walls().length}</span></div></div>
      <div class="actions"><button class="btn" id="pePanelSelect">${tr('选择 / 修改已有元素','Select / edit elements')}</button><button class="btn primary" id="pePanelFinish">${tr('完成 · 布置家具','Finish · Furnish')}</button></div></section>`;
      $('#pePanelSelect').onclick=()=>setEditorTool('select'); $('#pePanelFinish').onclick=()=>setActive(false); return true;
    }
    const label=names[sel.kind]||names.select, v=vertical(r), width=r[2]-r[0], height=r[3]-r[1], length=v?height:width;
    let content='';
    if (sel.kind==='room'){
      const st=state.rooms[item.id];
      content=`<label>${tr('房间名称','Room name')}<input id="peName" value="${esc(st.name)}"></label><div class="form-grid">
        ${field('peX',tr('左边 X mm','Left X mm'),r[0])}${field('peY',tr('上边 Y mm','Top Y mm'),r[1])}
        ${field('peW',tr('净宽 mm','Net width mm'),width,300)}${field('peD',tr('净深 mm','Net depth mm'),height,300)}</div>
        <label>${tr('地面材料','Flooring')}<select id="peMat">${Object.entries(MATS).map(([id,m])=>`<option value="${id}" ${id===st.mat?'selected':''}>${esc(nm(m.name))}</option>`).join('')}</select></label>
        <label class="pe-check"><input id="peCount" type="checkbox" ${item.counted===false?'':'checked'}>${tr('计入使用面积','Include in net floor area')}</label>
        <div class="pe-note">${ownWalls(item.id).length?tr('移动或调整房间时，围墙和墙上的门窗同步更新。移动房间也会带走室内家具。','Room moves and resizing update its walls and openings. Moving a room also carries furniture inside it.'):tr('此房间的墙体是独立元素。修改房间后，请分别调整周围墙体与门窗。','This room has independent walls. After editing it, adjust surrounding walls and openings separately.')}</div>`;
    } else if (sel.kind==='wall'){
      content=`<div class="form-grid">${field('peX',tr('左边 X mm','Left X mm'),r[0])}${field('peY',tr('上边 Y mm','Top Y mm'),r[1])}
      ${field('peLength',tr('长度 mm','Length mm'),length,300)}${field('peThicknessSel',tr('厚度 mm','Thickness mm'),v?width:height,50)}</div>
      <label>${tr('墙体类型','Wall type')}<select id="peType">${wallTypeOptions(item[4])}</select></label>
      <div class="pe-note">${item[5]?.roomId?tr('该墙与房间关联，移动墙体或改变长度会调整对应房间边界；厚度单独调整。','This wall belongs to a room. Moving it or changing its length adjusts the room boundary; thickness changes separately.'):tr('拖动两端手柄修改墙长；拖动侧边手柄修改厚度。','Drag end handles to change length; drag the side handle to change thickness.')}</div>`;
    } else {
      content=`<div class="form-grid">${field('peOpeningLength',tr('洞口宽度 mm','Opening width mm'),length,100)}
      ${field('peOpeningPosition',v?tr('中心 Y mm','Center Y mm'):tr('中心 X mm','Center X mm'),v?(r[1]+r[3])/2:(r[0]+r[2])/2)}</div>
      <div class="pe-note">${tr('沿墙拖动移动；拖动两端手柄改宽。靠近其他墙体时可换墙吸附。','Drag along a wall to move; drag end handles to resize. Move near another wall to attach there.')}</div>`;
      if (sel.kind==='door') content+=`<label>${tr('门名称','Door name')}<input id="peName" value="${esc(item.name)}"></label><div class="actions"><button class="btn" id="peSwing">${tr('翻转开启方向','Flip swing')}</button><button class="btn" id="peHinge">${tr('交换铰链端','Swap hinge end')}</button></div><label class="pe-check"><input id="peEntry" type="checkbox" ${item.entry?'checked':''}>${tr('入户门','Entry door')}</label>`;
      if (!(sel.kind==='window'?item[4]?.wallId:item.wallId)) content+=`<div class="pe-note">${tr('该门窗来自原始户型。拖到墙体上即可建立关联。','This opening is from the original plan. Drag it onto a wall to link it.')}</div>`;
    }
    p.innerHTML=`<section class="pe-panel"><h3>${tr(...label)} <small>${tr('精确参数 · mm','Exact dimensions · mm')}</small></h3>${content}<div class="actions"><button class="btn" id="peBack">${tr('取消选择','Deselect')}</button><button class="btn danger" id="peDelete">${tr('删除','Delete')}</button></div></section>`;
    const change=(id,fn)=>{ const el=$(id); if(el)el.onchange=e=>{ const value=Number(e.target.value); if(Number.isFinite(value))mutate(()=>{ const current=resolve(sel); if(current)fn(current,value); }); }; };
    $('#peBack').onclick=()=>select(null); $('#peDelete').onclick=deleteSelected;
    if (sel.kind==='room'){
      $('#peName').onchange=e=>mutate(()=>{ const room=resolve(sel), name=e.target.value.trim()||state.rooms[sel.id].name; room.name=name; state.rooms[sel.id].name=name; });
      const resize=(index,size)=>(room,n)=>{ const b=roomBounds(room); if(size)b[index]=b[index-2]+Math.max(300,n); else { const delta=n-b[index]; b[index]=n; b[index+2]+=delta; } transformRoom(room,b,!size); };
      change('#peX',resize(0,false)); change('#peY',resize(1,false)); change('#peW',resize(2,true)); change('#peD',resize(3,true));
      $('#peMat').onchange=e=>mutate(()=>{ resolve(sel).mat=e.target.value; state.rooms[sel.id].mat=e.target.value; });
      $('#peCount').onchange=e=>mutate(()=>resolve(sel).counted=e.target.checked);
    } else if(sel.kind==='wall'){
      change('#peX',(w,n)=>{ const b=w.slice(0,4), delta=n-b[0]; b[0]+=delta;b[2]+=delta;changeWall(w,b); });
      change('#peY',(w,n)=>{ const b=w.slice(0,4), delta=n-b[1]; b[1]+=delta;b[3]+=delta;changeWall(w,b); });
      change('#peLength',(w,n)=>{ const b=w.slice(0,4); if(vertical(w))b[3]=b[1]+Math.max(300,n);else b[2]=b[0]+Math.max(300,n);changeWall(w,b); });
      change('#peThicknessSel',setWallThickness); $('#peType').onchange=e=>mutate(()=>{ resolve(sel)[4]=e.target.value;structuralChange(); });
    } else {
      const adjust=(item,n,isLength)=>{
        const b=openingRect(sel.kind,item), v=vertical(b), center=v?(b[1]+b[3])/2:(b[0]+b[2])/2, length=v?b[3]-b[1]:b[2]-b[0];
        const id=sel.kind==='window'?item[4]?.wallId:item.wallId, wall=findWall(id);
        if(wall)placeOpening(sel.kind,item,wall,isLength?center:n,isLength?Math.max(100,n):length);
        else { const copy=b.slice(0,4), l=isLength?Math.max(100,n):length, c=isLength?center:n; if(v){copy[1]=c-l/2;copy[3]=c+l/2;}else{copy[0]=c-l/2;copy[2]=c+l/2;}if(sel.kind==='window')item.splice(0,4,...copy);else{item.rect=copy;if(sel.kind==='door')poseDoor(item);} }
        structuralChange();
      };
      change('#peOpeningLength',(item,n)=>adjust(item,n,true)); change('#peOpeningPosition',(item,n)=>adjust(item,n,false));
      if(sel.kind==='door'){
        $('#peName').onchange=e=>mutate(()=>resolve(sel).name=e.target.value.trim()||tr('房门','Door'));
        $('#peSwing').onclick=()=>mutate(()=>{ const d=resolve(sel);doorOptions(d);d.side=(d.side===-1?1:-1);poseDoor(d); });
        $('#peHinge').onclick=()=>mutate(()=>{ const d=resolve(sel);doorOptions(d);d.hingeEnd=d.hingeEnd===1?0:1;poseDoor(d); });
        $('#peEntry').onchange=e=>mutate(()=>resolve(sel).entry=e.target.checked);
      }
    }
    return true;
  }
  function renderOverlay(){
    if(!active || is3D()){overlay.innerHTML='';return;}
    const k=1/view.s, color='#2f7e89', stroke=`stroke="${color}" vector-effect="non-scaling-stroke"`, hs=COARSE?8:5, hit=COARSE?17:10;
    const handle=(x,y,kind)=>`<circle data-plan-handle="${kind}" cx="${x}" cy="${y}" r="${hit*k}" fill="transparent"/><rect data-plan-handle="${kind}" x="${x-hs*k}" y="${y-hs*k}" width="${2*hs*k}" height="${2*hs*k}" fill="white" ${stroke} stroke-width="1.6"/>`;
    const outline=(r,fill='rgba(47,126,137,.06)')=>`<rect x="${r[0]}" y="${r[1]}" width="${r[2]-r[0]}" height="${r[3]-r[1]}" fill="${fill}" ${stroke} stroke-width="1.8" stroke-dasharray="5 3" pointer-events="none"/>`;
    const caption=(r,text)=>`<text x="${(r[0]+r[2])/2}" y="${r[3]+24*k}" text-anchor="middle" font-size="${12*k}" fill="${color}" font-weight="600" stroke="white" stroke-width="${3*k}" paint-order="stroke" pointer-events="none">${esc(text)}</text>`;
    let s='';
    const hitbox=(r,kind,id)=>`<rect data-plan-kind="${kind}" data-plan-id="${id}" x="${r[0]}" y="${r[1]}" width="${Math.max(1,r[2]-r[0])}" height="${Math.max(1,r[3]-r[1])}" fill="transparent"/>`;
    // The decoration layer disables wall hit testing; building uses its own targets.
    walls().forEach((w,i)=>s+=hitbox(w,'wall',wid(w,i)));
    plan().windows.forEach(w=>s+=hitbox(w,'window',w[4].id));
    plan().doors.forEach(d=>s+=hitbox(d.rect,'door',d.id)); plan().slides.forEach(d=>s+=hitbox(d.rect,'slide',d.id));
    const r=selectedRect(), sel=ui.sel;
    if(r){
      s+=outline(r);
      if(sel.kind==='room'){
        [[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]].forEach(([x,y],i)=>s+=handle(x,y,'corner'+i));
        s+=caption(r,`${round(r[2]-r[0])} × ${round(r[3]-r[1])} mm`);
      } else {
        const v=vertical(r), cx=(r[0]+r[2])/2, cy=(r[1]+r[3])/2;
        s+=handle(v?cx:r[0],v?r[1]:cy,'end0')+handle(v?cx:r[2],v?r[3]:cy,'end1');
        if(sel.kind==='wall')s+=handle(v?r[2]:cx,v?cy:r[3],'thickness');
        s+=caption(r,`${round(v?r[3]-r[1]:r[2]-r[0])} mm${sel.kind==='wall'?' · '+round(v?r[2]-r[0]:r[3]-r[1])+' mm':''}`);
      }
    }
    if(gesture?.preview){
      const r=gesture.preview;
      s+=outline(r,'rgba(47,126,137,.12)')+caption(r,gesture.kind==='create-room'?`${round(r[2]-r[0])} × ${round(r[3]-r[1])} mm · ${((r[2]-r[0])*(r[3]-r[1])/1e6).toFixed(2)} m²`:`${round(Math.max(r[2]-r[0],r[3]-r[1]))} mm${gesture.snapPoints?.length?' · '+tr('已吸附','Snapped'):''}`);
    }
    (gesture?.snapPoints||[]).forEach(p=>s+=`<circle data-plan-snap="1" cx="${p.x}" cy="${p.y}" r="${4*k}" fill="${color}" stroke="white" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
    overlay.innerHTML=s; updateHint();
  }
  function usePoint(e,excludedRoom){
    const p=toMM(e); return e.shiftKey?{x:round(p.x),y:round(p.y)}:snapPointEditor(p,excludedRoom);
  }
  function capture(e){e.preventDefault();e.stopImmediatePropagation();}
  function begin(e){
    if(!active || is3D() || e.button===2)return;
    if(e.target.closest('[data-fid]') && tool==='select'){setActive(false);return;}
    capture(e); closeDrawers(); const menu=$('details.menu');if(menu)menu.open=false;
    if(gesture)cancel();
    const p=usePoint(e), raw=toMM(e), before=snap();
    const base={pointer:e.pointerId,sx:e.clientX,sy:e.clientY,start:p,rawStart:{x:raw.x,y:raw.y},before,moved:false};
    const handle=e.target.closest('[data-plan-handle]');
    if(e.button===1 || (tool==='select' && !handle && !e.target.closest('[data-plan-kind],[data-wall],[data-room]'))){
      gesture={...base,kind:'pan',x0:view.x0,y0:view.y0};if(e.button!==1)select(null);
    } else if(tool==='room')gesture={...base,kind:'create-room'};
    else if(tool==='wall')gesture={...base,kind:'create-wall',thickness:settings.thickness};
    else if(['door','window','slide'].includes(tool)){
      const host=nearestWall(raw);
      if(!host)return toast(tr('先在墙体上按下，再沿墙拖出洞口。','Start on a wall, then drag along it to create an opening.'));
      const start=host.v?p.y:p.x;gesture={...base,kind:'create-opening',openingKind:tool,hostId:host.id,axisStart:start};
      previewOpening(gesture,p);
    } else {
      const own=e.target.closest('[data-plan-kind]'), wall=e.target.closest('[data-wall]'), room=e.target.closest('[data-room]');
      const sel=handle?ui.sel:own?{kind:own.dataset.planKind,id:own.dataset.planId}:wall?{kind:'wall',id:wall.dataset.wall}:room?{kind:'room',id:room.dataset.room}:null;
      if(!resolve(sel)){select(null);return;}
      select(sel);gesture={...base,kind:handle?'resize':'move',sel:{...sel},handle:handle?.dataset.planHandle,original:clone(resolve(sel)),rect:selectedRect(sel).slice(0,4)};
    }
    svg.setPointerCapture(e.pointerId);renderOverlay();
  }
  function previewOpening(g,p){
    const w=findWall(g.hostId); if(!w)return;
    const v=vertical(w), end=v?p.y:p.x, length=g.moved?Math.max(100,Math.abs(end-g.axisStart)):settings.opening;
    const center=g.moved?(end+g.axisStart)/2:g.axisStart, temp={rect:[],side:1,hingeEnd:0};
    placeOpening('door',temp,w,center,length);g.preview=temp.rect;g.center=center;g.length=length;
  }
  function move(e){
    if(!active || is3D())return;
    capture(e);const raw=toMM(e);$('#cx').textContent=round(raw.x)+' mm';$('#cy').textContent=round(raw.y)+' mm';
    const g=gesture;if(!g || g.pointer!==e.pointerId)return;
    if(Math.hypot(e.clientX-g.sx,e.clientY-g.sy)>=TAP)g.moved=true;
    if(g.kind==='pan'){
      if(g.moved){view.x0=g.x0-(e.clientX-g.sx)/view.s;view.y0=g.y0-(e.clientY-g.sy)/view.s;applyView();}return;
    }
    const p=usePoint(e,g.sel?.kind==='room'?g.sel.id:null);
    if(g.kind==='create-room'){
      g.preview=[Math.min(g.start.x,p.x),Math.min(g.start.y,p.y),Math.max(g.start.x,p.x),Math.max(g.start.y,p.y)];renderOverlay();return;
    }
    if(g.kind==='create-wall'){
      const draft=wallDraft(g.rawStart,raw,g.thickness,settings.grid&&!e.shiftKey);
      g.preview=draft.rect;g.snapPoints=draft.points;renderOverlay();return;
    }
    if(g.kind==='create-opening'){previewOpening(g,p);renderOverlay();return;}
    if(!g.moved)return;
    state=JSON.parse(g.before); const item=resolve(g.sel);if(!item)return;
    const r=g.rect.slice(),v=vertical(r),rawDx=round(raw.x-g.rawStart.x),rawDy=round(raw.y-g.rawStart.y),dx=e.shiftKey?rawDx:q(raw.x-g.rawStart.x),dy=e.shiftKey?rawDy:q(raw.y-g.rawStart.y);
    if(g.kind==='move'){
      if(g.sel.kind==='room')transformRoom(item,[r[0]+dx,r[1]+dy,r[2]+dx,r[3]+dy],true);
      else if(g.sel.kind==='wall'){
        if(item[5]?.roomId && Number.isInteger(item[5].edge)){
          // A room boundary moves only perpendicular to itself.
          const snapped=wallMoveSnap(v?[r[0]+rawDx,r[1],r[2]+rawDx,r[3]]:[r[0],r[1]+rawDy,r[2],r[3]+rawDy],v?[r[0]+dx,r[1],r[2]+dx,r[3]]:[r[0],r[1]+dy,r[2],r[3]+dy],g.sel.id,item[5].roomId,settings.grid&&!e.shiftKey,v?0:1);
          changeWall(item,snapped.rect);g.snapPoints=snapped.points;
        } else {const snapped=wallMoveSnap([r[0]+rawDx,r[1]+rawDy,r[2]+rawDx,r[3]+rawDy],[r[0]+dx,r[1]+dy,r[2]+dx,r[3]+dy],g.sel.id,null,settings.grid&&!e.shiftKey);changeWall(item,snapped.rect);g.snapPoints=snapped.points;}
      } else {
        const host=nearestWall(raw,35/view.s), id=g.sel.kind==='window'?item[4]?.wallId:item.wallId;
        const wall=host?.wall||findWall(id);
        if(wall){
          const newId=host?.id||id;if(g.sel.kind==='window')item[4].wallId=newId;else item.wallId=newId;
          placeOpening(g.sel.kind,item,wall,vertical(wall)?p.y:p.x,v?r[3]-r[1]:r[2]-r[0]);
        } else { const target=[r[0]+dx,r[1]+dy,r[2]+dx,r[3]+dy];if(g.sel.kind==='window')item.splice(0,4,...target);else{item.rect=target;if(g.sel.kind==='door'){item.h=item.h.map((n,i)=>n+(i?dy:dx));}} }
        structuralChange();
      }
    } else if(g.sel.kind==='room'){
      const corner=+g.handle.slice(6), xindex=[0,2,2,0][corner],yindex=[1,1,3,3][corner];
      r[xindex]=xindex===0?Math.min(p.x,r[2]-300):Math.max(p.x,r[0]+300);r[yindex]=yindex===1?Math.min(p.y,r[3]-300):Math.max(p.y,r[1]+300);transformRoom(item,r);
    } else if(g.sel.kind==='wall'){
      if(g.handle==='thickness')setWallThickness(item,v?p.x-r[0]:p.y-r[1]);
      else {const i=g.handle==='end0'?(v?1:0):(v?3:2),snapped=wallEndSnap(r,i,raw,g.sel.id,item[5]?.roomId,settings.grid&&!e.shiftKey);changeWall(item,snapped.rect);g.snapPoints=snapped.points;}
    } else {
      const start=v?r[1]:r[0],end=v?r[3]:r[2],coordinate=v?p.y:p.x;
      const a=g.handle==='end0'?Math.min(coordinate,end-100):start,b=g.handle==='end1'?Math.max(coordinate,start+100):end;
      const wall=findWall(g.sel.kind==='window'?item[4]?.wallId:item.wallId);
      if(wall)placeOpening(g.sel.kind,item,wall,(a+b)/2,b-a);
      else {if(v){r[1]=a;r[3]=b;}else{r[0]=a;r[2]=b;}if(g.sel.kind==='window')item.splice(0,4,...r);else{item.rect=r;if(g.sel.kind==='door')poseDoor(item);}}
      structuralChange();
    }
    renderAll();
  }
  function end(e){
    if(!active || !gesture || gesture.pointer!==e.pointerId)return;
    capture(e);if(e.type==='pointercancel'){cancel();return;}
    if(gesture.kind==='create-wall' || (['move','resize'].includes(gesture.kind) && gesture.sel?.kind==='wall'))move(e);
    const g=gesture;gesture=null;
    if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
    if(g.kind==='create-room'){
      if(g.preview && g.preview[2]-g.preview[0]>=300 && g.preview[3]-g.preview[1]>=300){ui.sel=addRoom(g.preview);commit(g.before);tool='select';relang();svg.classList.add('pe-select');}
      else if(g.moved)toast(tr('房间净宽与净深至少为 300 mm。','Room width and depth must be at least 300 mm.'));
    } else if(g.kind==='create-wall'){
      if(g.moved && g.preview && Math.max(g.preview[2]-g.preview[0],g.preview[3]-g.preview[1])>=300){ui.sel=addWall(g.preview);commit(g.before);tool='select';relang();svg.classList.add('pe-select');}
      else if(g.moved)toast(tr('墙体长度至少为 300 mm。','Wall length must be at least 300 mm.'));
    } else if(g.kind==='create-opening'){
      const w=findWall(g.hostId);if(w){ui.sel=addOpening(g.openingKind,{wall:w,id:g.hostId,v:vertical(w)},g.center,g.length);commit(g.before);tool='select';relang();svg.classList.add('pe-select');}
    } else if(g.kind!=='pan' && snap()!==g.before)commit(g.before);
    renderAll();
  }
  function cancel(){
    const g=gesture;gesture=null;
    if(g){if(g.kind==='move'||g.kind==='resize')state=JSON.parse(g.before);if(svg.hasPointerCapture(g.pointer))svg.releasePointerCapture(g.pointer);renderAll();}
    overlay.innerHTML='';
  }
  svg.addEventListener('pointerdown',begin,true);svg.addEventListener('pointermove',move,true);svg.addEventListener('pointerup',end,true);svg.addEventListener('pointercancel',end,true);
  svg.addEventListener('dblclick',e=>{if(active&&!is3D())capture(e);},true);
  document.addEventListener('keydown',e=>{
    if(!active || is3D() || e.target.matches('input,textarea,select'))return;
    const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
    if(mod){if((key==='z'||key==='y')&&gesture)cancel();return;}
    if(key==='escape'){e.preventDefault();e.stopImmediatePropagation();if(gesture)cancel();else if(tool!=='select')setEditorTool('select');else select(null);renderOverlay();return;}
    if(key==='v'){e.stopImmediatePropagation();setEditorTool('select');return;}
    if(key==='delete'||key==='backspace'){e.preventDefault();e.stopImmediatePropagation();deleteSelected();return;}
    if(key==='r'&&ui.sel?.kind==='door'){e.preventDefault();e.stopImmediatePropagation();mutate(()=>{const d=resolve();doorOptions(d);d.side=d.side===-1?1:-1;poseDoor(d);});return;}
    if(key.startsWith('arrow')&&resolve()){
      e.preventDefault();e.stopImmediatePropagation();const n=e.shiftKey?100:10,dx=key==='arrowleft'?-n:key==='arrowright'?n:0,dy=key==='arrowup'?-n:key==='arrowdown'?n:0;
      mutate(()=>{const item=resolve(),r=selectedRect(),kind=ui.sel.kind;if(kind==='room')transformRoom(item,[r[0]+dx,r[1]+dy,r[2]+dx,r[3]+dy],true);else if(kind==='wall')changeWall(item,[r[0]+dx,r[1]+dy,r[2]+dx,r[3]+dy]);else{const wall=findWall(kind==='window'?item[4]?.wallId:item.wallId),v=vertical(r);if(wall)placeOpening(kind,item,wall,(v?(r[1]+r[3])/2+dy:(r[0]+r[2])/2+dx),v?r[3]-r[1]:r[2]-r[0]);else{const copy=[r[0]+dx,r[1]+dy,r[2]+dx,r[3]+dy];if(kind==='window')item.splice(0,4,...copy);else{item.rect=copy;if(kind==='door')item.h=item.h.map((n,i)=>n+(i?dy:dx));}}structuralChange();}});
    }
  },true);
  window.PlanEditor={get active(){return active;},renderOverlay,renderPanel,setActive,cancel,relang,setTool:setEditorTool,deleteSelected,
    inspect:()=>({active,tool,drag:gesture?{kind:gesture.kind,moved:gesture.moved,pointer:gesture.pointer,preview:gesture.preview||null}:null,selection:ui.sel?{...ui.sel}:null,settings:{...settings}})};
  relang();
})();
