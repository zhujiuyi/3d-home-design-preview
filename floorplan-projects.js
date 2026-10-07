/* Complete project files and named local snapshots. No server or account required. */
(function(){
  'use strict';
  const SAVED_KEY='huxing-saved-projects-v2';
  const style=document.createElement('style');
  style.textContent=`.project-dialog{width:min(560px,92vw);max-height:80vh;border:1px solid var(--line);border-radius:14px;padding:22px;background:var(--panel);color:var(--ink)}
    .project-dialog::backdrop{background:rgba(35,30,24,.38)}.project-dialog h2{margin:0 0 14px;font-size:18px}
    .project-dialog input{width:100%;padding:9px;border:1px solid var(--line);border-radius:7px;margin:6px 0 12px}
    .project-dialog .actions{justify-content:flex-end}.saved-project{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--line)}
    .saved-project div{flex:1;min-width:0}.saved-project strong{display:block;overflow:hidden;text-overflow:ellipsis}.saved-project small{color:var(--muted)}
    .saved-project .btn{border:1px solid var(--line)}.project-error{color:#b3372a}`;
  document.head.appendChild(style);
  const dialog=document.createElement('dialog');dialog.className='project-dialog';document.body.appendChild(dialog);

  function replaceProject(next,{edit=false}={}){
    window.PlanEditor?.cancel();
    const before=snap();
    state=next;ui.sel=null;ui.mA=ui.mCur=null;
    syncGeometry();commit(before);
    if(edit) window.PlanEditor?.setTool?.('room');
    window.PlanEditor?.setActive(edit);
    renderAll();fitView();
  }
  function validSnapshot(){
    window.PlanEditor?.cancel();
    return fixState(state);
  }
  async function newBlank(name='未命名户型'){
    if(is3D()) await setView('2d');
    replaceProject(fixState({version:2,name,floorplan:{rooms:[],walls:[],windows:[],doors:[],slides:[],legacyDetails:false},
      rooms:{},furniture:[],demolished:[],measures:[]}),{edit:true});
    ui.layers.grid=true;renderAll();
    toast(tr('空白户型已创建，拖拽画布绘制第一个房间。','New floor plan created. Drag on the canvas to draw your first room.'));
  }
  function openNew(){
    dialog.innerHTML=`<h2>${tr('新建空白户型','New floor plan')}</h2><label>${tr('方案名称','Project name')}<input id="newProjectName" maxlength="120" value="${tr('未命名户型','Untitled floor plan')}"></label>
      <p class="muted">${tr('从空白画布开始，通过拖拽搭建房间、墙体和门窗。当前方案可用撤销恢复。','Start with an empty canvas and drag to build rooms, walls and openings. You can undo to restore the current project.')}</p>
      <div class="actions"><button class="btn" data-close>${tr('取消','Cancel')}</button><button class="btn primary" id="createProject">${tr('创建户型','Create')}</button></div>`;
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.querySelector('#createProject').onclick=()=>{const name=dialog.querySelector('input').value.trim()||tr('未命名户型','Untitled floor plan');dialog.close();newBlank(name);};
    dialog.showModal();dialog.querySelector('input').select();
  }
  function readSaved(){
    const raw=localStorage.getItem(SAVED_KEY);
    if(!raw) return [];
    const records=JSON.parse(raw);
    if(!Array.isArray(records)) throw new Error(tr('已保存方案列表损坏','Saved project list is invalid'));
    return records;
  }
  function saveLocal(){
    try{
      const project=validSnapshot(),records=readSaved();
      const existing=records.find(r=>r.name===project.name);
      const record={id:existing?.id||'project-'+Date.now().toString(36),name:project.name,updatedAt:new Date().toISOString(),project};
      if(existing) records[records.indexOf(existing)]=record;else records.push(record);
      localStorage.setItem(SAVED_KEY,JSON.stringify(records));save();
      toast(tr(`「${project.name}」已保存到此浏览器；同名保存会更新方案。`,`Saved "${project.name}" in this browser. Saving the same name updates it.`));
      return record;
    }catch(e){toast(tr('本地保存失败，请导出 JSON 文件备份。','Local save failed. Export a JSON backup.'));return null;}
  }
  function openSaved(){
    let records;
    try{records=readSaved();}catch(e){toast(e.message);return;}
    dialog.innerHTML=`<h2>${tr('加载已保存方案','Load saved project')}</h2>
      <p class="muted">${tr('方案保存在此浏览器中；跨设备使用请导出、导入 JSON。加载操作可撤销。','Projects are saved in this browser. Export/import JSON to transfer them. Loading is undoable.')}</p>
      ${records.map((r,i)=>`<div class="saved-project"><div><strong>${esc(r.name||'')}</strong><small>${esc(new Date(r.updatedAt).toLocaleString())} · ${r.project?.floorplan?.rooms?.length||0} ${tr('个房间','rooms')} · ${r.project?.furniture?.length||0} ${tr('件家具','items')}</small></div><button class="btn" data-load="${i}">${tr('加载','Load')}</button></div>`).join('')||`<p class="muted">${tr('暂无已保存的方案。先使用「保存户型与装修方案」。','No saved projects. Choose Save project locally first.')}</p>`}
      <div class="actions"><button class="btn" id="importFromFile">${tr('从 JSON 文件导入','Import JSON file')}</button><button class="btn" data-close>${tr('关闭','Close')}</button></div>`;
    dialog.querySelectorAll('[data-load]').forEach(b=>b.onclick=()=>{
      try{const normalized=fixState(records[+b.dataset.load].project);replaceProject(normalized);dialog.close();toast(tr('完整方案已加载','Full project loaded'));}
      catch(e){toast(tr('该方案数据无效：','Invalid project: ')+e.message);}
    });
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.querySelector('#importFromFile').onclick=()=>{dialog.close();$('#fileIn').click();};
    dialog.showModal();
  }
  function exportJSON(){
    try{const project=validSnapshot();const filename=(project.name||'floor-plan').replace(/[\\/:*?"<>|]/g,'_');
      download(filename+'.json',new Blob([JSON.stringify(project,null,2)],{type:'application/json'}));return project;
    }catch(e){toast(tr('方案无法导出：','Could not export project: ')+e.message);return null;}
  }
  function importJSON(text){
    try{const project=fixState(JSON.parse(text));replaceProject(project);toast(tr('户型与装修方案已导入','Floor plan and interior design imported'));return true;}
    catch(e){toast(tr('文件格式不正确：','Invalid project file: ')+e.message);return false;}
  }
  async function loadSample(){
    if(is3D()) await setView('2d');
    replaceProject(defaultState());toast(tr('示例户型已加载（可撤销）','Sample floor plan loaded (undoable)'));
  }
  $('#newPlan').onclick=openNew;$('#saveProject').onclick=saveLocal;$('#loadProject').onclick=openSaved;
  window.ProjectFiles={newBlank,saveLocal,openSaved,exportJSON,importJSON,loadSample};
})();
