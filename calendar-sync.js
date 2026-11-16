
/* Personal Planner calendar integrations. No passwords or Google tokens are stored in app backups. */
(() => {
  'use strict';
  const API='https://www.googleapis.com/calendar/v3';
  const cfg = S.calendarConnections ||= {clientId:'', googleSources:[], icloudUrl:'', icloudSources:[], lastSync:'', lastError:''};
  cfg.googleSources ||= []; cfg.icloudSources ||= []; cfg.googleMode ||= 'bridge';
  const sessions = new Map(); // Google access tokens kept only in memory
  let appleSessionToken = ''; // Bridge bearer token entered for this app session only
  let pendingGoogleURL = ''; // One-time Google sign-in URL (contains state, never a secret)
  let syncing=false;
  const qs=encodeURIComponent;
  const key=(source,account,calendar,id)=>[source,account,calendar,id].join('|');
  const readKey=e=>key(e.syncSource,e.syncAccount||'',e.syncCalendar||'',e.syncId||'');
  const fmtDate=d=>ymd(d);
  const fmtTime=d=>pad(d.getHours())+':'+pad(d.getMinutes());
  const status=()=>cfg.lastSync?`Last sync: ${new Date(cfg.lastSync).toLocaleString()}`:'Not synced yet';
  const detail=(s)=>esc(String(s||''));
  const notify=(s)=>{cfg.lastError=String(s||'');save();toast(s)};
  const connectedCalendars=()=>[
    ...cfg.googleSources.filter(c=>c.enabled&&sessions.has(c.email)&&c.accessRole!=='reader').map(c=>({...c,source:'google',acc:c.email})),
    ...cfg.icloudSources.filter(c=>c.enabled&&appleSessionToken).map(c=>({...c,source:'icloud',acc:'icloud'}))
  ];
  function selectedDest(e){return e?.syncSource&&e.syncCalendar?`${e.syncSource}|${e.syncAccount||'icloud'}|${e.syncCalendar}`:'local';}
  function destinations(e){const opts=[`<option value="local" ${!e?.syncSource?'selected':''}>This planner only</option>`];
    for(const c of connectedCalendars()) {
      const dest=`${c.source}|${c.acc}|${c.id}`;
      const disabled=e?.syncSource&&selectedDest(e)!==dest;
      opts.push(`<option value="${esc(dest)}" ${selectedDest(e)===dest?'selected':''} ${disabled?'disabled':''}>${detail(c.name)} (${c.source==='google'?detail(c.email):'iCloud'})</option>`);
    }
    return `<label>Save to calendar<select id="sync-dest" ${e?.syncSource?'disabled':''}>${opts.join('')}</select></label><p class="sub">Synced events stay on their original calendar. Select a destination before creating a new event. Calendar connections require internet.</p>`;
  }
  function calendarSettings(){return `<div id="sync-settings" style="display:grid;gap:11px">
    <h2>Calendar Connections</h2>
    <p class="sub">Connect accounts and choose which calendars to show. Only selected calendars are imported. The app syncs while open; Google asks for permission again when a session expires. Events are never copied from one provider to another automatically.</p>
    <div class="sync-panel"><strong>Google Calendar</strong>
      <p class="sub">Personal Gmail and UNC Charlotte Google can both be connected. For the installed iPad app, use the private Cloudflare bridge with a secure OAuth redirect; the browser-only method is a fallback. See the ZIP setup guide.</p>
      <label class="sub">Google connection method<select id="g-mode"><option value="bridge" ${cfg.googleMode==='bridge'?'selected':''}>Private bridge — recommended for iPad Home Screen app</option><option value="browser" ${cfg.googleMode==='browser'?'selected':''}>Browser sign-in — Safari tab only</option></select></label>
      ${cfg.googleMode==='browser'?`<label class="sub">Google OAuth Web Client ID<input id="g-client" type="text" value="${detail(cfg.clientId)}" placeholder="12345-abcdef.apps.googleusercontent.com" autocapitalize="none" spellcheck="false"></label>`:''}
      <div class="ctl"><button class="btn pri" data-a="gconnect">Authorize Google account</button><button class="btn" data-a="grefresh">Refresh connected accounts</button><button class="btn" data-a="gsync">Sync Google</button></div>
      ${pendingGoogleURL?`<a class="btn pri" target="_blank" rel="noopener noreferrer" href="${detail(pendingGoogleURL)}">Continue Google sign-in in Safari</a><p class="sub">After approving Google, return here and tap Refresh connected accounts.</p>`:''}
      ${cfg.googleSources.length?cfg.googleSources.map((c,i)=>`<div class="sync-source"><label class="sync-check"><input type="checkbox" data-g-enable="${i}" ${c.enabled?'checked':''}> <span>${detail(c.name)}<small>${detail(c.email)} · ${detail(c.accessRole)}</small></span></label><label class="sub">Category<select data-g-category="${i}">${P.map(p=>`<option value="${p.id}" ${c.category===p.id?'selected':''}>${p.e} ${detail(p.n)}</option>`).join('')}</select></label></div>`).join(''):'<p class="sub">No Google calendars discovered yet.</p>'}
      <p class="sub">Google accounts available to this app session: ${[...sessions.keys()].map(detail).join(', ')||'none'}.</p>
    </div>
    <div class="sync-panel"><strong>Private Calendar Bridge (Google and iCloud)</strong><p class="sub">The Cloudflare Worker handles Google sign-in outside the iPad Home Screen app and keeps Apple iCloud credentials in encrypted Worker Secrets. Your planner never receives Google refresh tokens or Apple passwords.</p>
       <label class="sub">Calendar bridge URL<input id="ic-url" type="url" value="${detail(cfg.icloudUrl)}" placeholder="https://my-private-icloud.workers.dev" autocapitalize="none" spellcheck="false"></label>
       <label class="sub">Private bridge access token (this session only)<input id="ic-token" type="password" value="" placeholder="Paste your private bridge token" autocomplete="off"></label>
       <div class="ctl"><button class="btn pri" data-a="icconnect">Connect iCloud</button><button class="btn" data-a="icsync">Sync iCloud</button></div>
       ${cfg.icloudSources.length?cfg.icloudSources.map((c,i)=>`<div class="sync-source"><label class="sync-check"><input type="checkbox" data-ic-enable="${i}" ${c.enabled?'checked':''}> <span>${detail(c.name)}</span></label><label class="sub">Category<select data-ic-category="${i}">${P.map(p=>`<option value="${p.id}" ${c.category===p.id?'selected':''}>${p.e} ${detail(p.n)}</option>`).join('')}</select></label></div>`).join(''):'<p class="sub">No iCloud calendars connected yet.</p>'}
       <p class="sub">iCloud events created through the planner can be edited or deleted here. Imported complex/recurring iCloud events are view-only to protect reminders and invitations; edit those in Apple Calendar.</p>
    </div>
    <div class="ctl"><button class="btn pri" data-a="syncall">Sync all connected calendars now</button></div>
    <p class="sub" id="sync-status">${detail(status())}${cfg.lastError?' · '+detail(cfg.lastError):''}</p>
    <p class="sub">Setup instructions are included in the ZIP. This is an app-open sync, not a background sync when your iPad is locked.</p>
  </div>`;}
  // Keep the original Settings layout. Replace only the calendar-links section.
  const originalSettings=sets;
  sets=function(){const h=originalSettings();const from=h.indexOf('<h2>Calendar connections</h2>');const to=h.indexOf('<h2>Import calendar (.ics)</h2>',from);
    return from>=0&&to>from ? h.slice(0,from)+calendarSettings()+h.slice(to):h.replace('</div>',calendarSettings()+'</div>');};
  // Keep original event editor, add a destination choice, and flag provider edits.
  const origSheet=sheet;
  sheet=function(e,date){origSheet(e,date);const card=$('#ov .sheet');if(!card)return;
    const saveButton=card.querySelector('[data-a="saveev"]');const row=saveButton?.closest('.ctl');if(row){row.insertAdjacentHTML('beforebegin',destinations(e));}
    if(e?.syncSource==='icloud'&&!e.syncManaged){
      card.insertAdjacentHTML('afterbegin','<p class="sub">This event comes from iCloud. For safety, edit it in Apple Calendar; its details are shown here for reference.</p>');
      if(saveButton)saveButton.disabled=true;
    }
  };
  const origSave=A.saveev;
  A.saveev=function(t){const existing=t.dataset.id?S.ev.find(x=>x.id==t.dataset.id):null;
    const dest=$('#sync-dest')?.value||'local';
    if(existing?.syncSource==='icloud'&&!existing.syncManaged)return notify('Edit this existing iCloud event in Apple Calendar.');
    const beforeIds=new Set(S.ev.map(x=>x.id));
    origSave(t);
    const event=existing||S.ev.find(x=>!beforeIds.has(x.id));if(!event)return;
    if(existing?.syncSource){event.syncDirty=true;}
    else if(dest!=='local'){
      const parts=dest.split('|');event.syncSource=parts[0];event.syncAccount=parts[1];event.syncCalendar=parts.slice(2).join('|');event.syncManaged=true;event.syncDirty=true;
    }
    save();if(event.syncDirty)queueMicrotask(()=>pushEvent(event).then(()=>{save();render()}).catch(x=>notify(x.message)));
  };
  const origDel=A.del;
  A.del=function(t){const e=S.ev.find(x=>x.id==t.dataset.id);
    if(!e?.syncSource)return origDel(t);
    if(!confirm(`Delete "${e.t}" from ${e.syncSource==='google'?'Google':'iCloud'} Calendar too? This cannot be undone.`))return;
    if(e.syncId){(S.syncDeletes ||= []).push({source:e.syncSource,account:e.syncAccount,calendar:e.syncCalendar,id:e.syncId,etag:e.syncEtag,managed:e.syncManaged});}
    origDel(t);save();queueMicrotask(()=>syncAll(true));
  };
  async function loadGoogleSDK(){if(window.google?.accounts?.oauth2)return;
    await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=resolve;s.onerror=()=>reject(Error('Could not load Google sign-in. Check the connection.'));document.head.append(s)});
  }
  async function gapi(email,path,opt={}){const s=sessions.get(email);if(!s||Date.now()>s.exp-15000)throw Error(`${email}: Reconnect or refresh your Google calendars to resume syncing.`);
    if(cfg.googleMode==='bridge'){
      const method=opt.method||'GET';return icRequest('/google/api?account='+qs(email)+'&path='+qs(path),method,method==='GET'?undefined:{data:opt.body?JSON.parse(opt.body):{},ifMatch:opt.headers?.['If-Match']||null});
    }
    const r=await fetch(API+path,{...opt,headers:{'Authorization':'Bearer '+s.token,'Content-Type':'application/json',...(opt.headers||{})}});
    if(!r.ok){const body=await r.text();throw Error(`Google ${r.status}: ${body.slice(0,180)}`)}return r.status===204?null:r.json();}
  async function connectGoogle(){if(cfg.googleMode==='bridge')return bridgeGoogleStart();const id=$('#g-client')?.value.trim()||cfg.clientId;if(!id.endsWith('.apps.googleusercontent.com'))return notify('Enter your Google OAuth Web Client ID in Settings first.');
    cfg.clientId=id;save();
    try{await loadGoogleSDK();
      const token=await new Promise((resolve,reject)=>{const client=google.accounts.oauth2.initTokenClient({client_id:id,scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/userinfo.email',callback:r=>r?.access_token?resolve(r):reject(Error(r?.error||'Google authorization failed'))});client.requestAccessToken({prompt:'select_account'});});
      const about=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+token.access_token}}).then(r=>r.ok?r.json():Promise.reject(Error('Could not identify Google account')));
      const email=about.email.toLowerCase();sessions.set(email,{token:token.access_token,exp:Date.now()+(Number(token.expires_in)||3300)*1000});
      const listing=await gapi(email,'/users/me/calendarList?maxResults=250');const previous=new Map(cfg.googleSources.map(c=>[c.email+'|'+c.id,c]));
      const newest=(listing.items||[]).filter(c=>!['freeBusyReader','none'].includes(c.accessRole)).map(c=>({email,id:c.id,name:c.summary||c.id,accessRole:c.accessRole,category:previous.get(email+'|'+c.id)?.category||'personal',enabled:previous.get(email+'|'+c.id)?.enabled||false}));
      cfg.googleSources=[...cfg.googleSources.filter(c=>c.email!==email),...newest];cfg.lastError='';save();render();toast(`${email} connected. Select calendars to show, then tap Sync.`);
    }catch(e){notify(e.message||e)}
  }
  async function bridgeGoogleStart(){try{
    const base=$('#ic-url')?.value.trim()||cfg.icloudUrl;if(!/^https:\/\//.test(base))return notify('Enter your private Calendar Bridge URL in the iCloud/Bridge section first.');
    cfg.icloudUrl=base;const result=await icRequest('/google/start','POST',{});
    if(new URL(result.authorizeUrl).origin!=='https://accounts.google.com')throw Error('Unexpected Google authorization address');
    pendingGoogleURL=result.authorizeUrl;save();render();toast('Tap Continue Google sign-in to finish authorization in Safari.');
  }catch(e){notify(e.message)}}
  async function bridgeGoogleRefresh(){try{
    const response=await icRequest('/google/accounts');if(!response.accounts?.length)return notify('No Google accounts are authorized yet. Tap Authorize Google first.');
    const old=new Map(cfg.googleSources.map(c=>[c.email+'|'+c.id,c]));const list=[];
    for(const email of response.accounts){sessions.set(email,{token:'bridge',exp:Infinity});const j=await gapi(email,'/users/me/calendarList?maxResults=250');
      for(const c of j.items||[]){if(['freeBusyReader','none'].includes(c.accessRole))continue;
        const was=old.get(email+'|'+c.id)||{};list.push({email,id:c.id,name:c.summary||c.id,accessRole:c.accessRole,enabled:!!was.enabled,category:was.category||'personal'});
      }
    }
    cfg.googleSources=list;pendingGoogleURL='';cfg.lastError='';save();render();toast('Google calendars found. Select the ones you want to sync.');
  }catch(e){notify(e.message)}}
  async function icRequest(path,method='GET',body){if(!appleSessionToken){const typed=$('#ic-token')?.value.trim();if(typed)appleSessionToken=typed;else throw Error('Enter your private Calendar Bridge token first.');}
    const base=cfg.icloudUrl.replace(/\/+$/,'');const url=new URL(path,base+'/');if(url.origin!==new URL(base).origin)throw Error('Invalid bridge URL');
    const r=await fetch(url.href,{method,headers:{'Authorization':'Bearer '+appleSessionToken,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const text=await r.text();let j={};try{j=JSON.parse(text)}catch{}
    if(!r.ok)throw Error(j.error||`iCloud bridge ${r.status}`);return j;
  }
  async function connectIcloud(){const url=$('#ic-url')?.value.trim();const token=$('#ic-token')?.value.trim();if(!/^https:\/\//.test(url||''))return notify('Enter the HTTPS URL of your Cloudflare Worker.');
    if(!token)return notify('Enter the bridge token created in Cloudflare Secrets.');
    cfg.icloudUrl=url;appleSessionToken=token;
    try{const j=await icRequest('/calendars');const previous=new Map(cfg.icloudSources.map(c=>[c.id,c]));
      cfg.icloudSources=j.calendars.map(c=>({id:c.id,name:c.name,enabled:previous.get(c.id)?.enabled||false,category:previous.get(c.id)?.category||'personal'}));cfg.lastError='';save();render();toast('iCloud bridge connected. Select calendars and tap Sync.');
    }catch(e){appleSessionToken='';notify(e.message)}
  }
  function localFromGoogle(o){const ad=!!o.start?.date;const start=ad?new Date(o.start.date+'T12:00:00'):new Date(o.start?.dateTime);const end=ad?null:new Date(o.end?.dateTime);
    return {t:o.summary||'(Untitled)',date:ad?o.start.date:fmtDate(start),ad:ad?1:0,st:ad?'':fmtTime(start),en:ad?'':fmtTime(end),n:o.description||'',rep:'none'};
  }
  function range(){const now=new Date();const l=new Date(now.getFullYear()-1,0,1);const h=new Date(now.getFullYear()+3,0,1);return {min:l.toISOString(),max:h.toISOString(),start:l,end:h};}
  function applyCalendarCategory(provider,account,c){
    const category=c.category||'personal';
    for(const event of S.ev){
      if(event.syncSource===provider&&event.syncAccount===account&&event.syncCalendar===c.id)event.p=category;
    }
    save();
  }
  function merge(provider,account,c,remotes,mapper){const known=new Map(S.ev.filter(e=>e.syncSource===provider&&e.syncAccount===account&&e.syncCalendar===c.id&&e.syncId).map(e=>[String(e.syncId),e]));
    const seen=new Set();let added=0,updated=0;
    for(const o of remotes){if(!o?.id)continue;seen.add(String(o.id));const ext=known.get(String(o.id));if(o.status==='cancelled'){
        if(ext&&!ext.syncDirty)S.ev=S.ev.filter(e=>e!==ext);
        continue;}
     if (provider === 'google' && o.eventType === 'workingLocation') {
      if (ext) { 
        S.ev = S.ev.filter(e => e !== ext);
  }
     continue;
}
      const fields=mapper(o);if(!fields.date||fields.date==='NaN-NaN-NaN')continue;
      if(ext){if(ext.syncDirty){if(ext.syncEtag&&o.etag&&ext.syncEtag!==o.etag)ext.syncConflict=true;continue;}
        Object.assign(ext,fields,{p:c.category||'personal',syncEtag:o.etag||'',syncManaged:ext.syncManaged||false,syncConflict:false});updated++;
      }else{S.ev.push({...fields,id:uid(),p:c.category||'personal',syncSource:provider,syncAccount:account,syncCalendar:c.id,syncId:o.id,syncEtag:o.etag||'',syncManaged:!!o.managed,syncDirty:false});added++;}
    }
    // Only remove remotely deleted copies when a complete selected-calendar fetch succeeded.
    const rng=range();
    S.ev=S.ev.filter(e=>!(e.syncSource===provider&&e.syncAccount===account&&e.syncCalendar===c.id&&!e.syncDirty&&!seen.has(String(e.syncId))&&e.date>=fmtDate(rng.start)&&e.date<fmtDate(rng.end)));
    applyCalendarCategory(provider,account,c);return {added,updated};
  }
  async function pullGoogle(){let total=0;const rg=range();for(const c of cfg.googleSources.filter(c=>c.enabled&&sessions.has(c.email))){
      const all=[];let next='';do{const params=new URLSearchParams({timeMin:rg.min,timeMax:rg.max,singleEvents:'true',showDeleted:'true',maxResults:'1000'});if(next)params.set('pageToken',next);
        const result=await gapi(c.email,`/calendars/${qs(c.id)}/events?${params}`);all.push(...(result.items||[]));next=result.nextPageToken||'';
      }while(next&&all.length<5000);
      if(next)throw Error(`Too many events in ${c.name}; no changes were imported.`);
      merge('google',c.email,c,all,localFromGoogle);total+=all.length;
    }return total;}
  async function pullIcloud(){let total=0;for(const c of cfg.icloudSources.filter(c=>c.enabled)){
      const result=await icRequest('/events?calendar='+qs(c.id));merge('icloud','icloud',c,result.events,o=>{const st=o.startIso?new Date(o.startIso):null,en=o.endIso?new Date(o.endIso):null;return {t:o.title,date:st?fmtDate(st):o.date,ad:o.allDay?1:0,st:st?fmtTime(st):o.start||'',en:en?fmtTime(en):o.end||'',n:o.description||'',rep:o.repeat||'none'};});total+=result.events.length;
    }return total;
  }
  function getRemoteBody(e){const b={summary:e.t,description:e.n||'',start:{},end:{}};const date=e.date;
    if(e.ad){b.start.date=date;const end=new Date(date+'T12:00:00');end.setDate(end.getDate()+1);b.end.date=fmtDate(end)}
    else{const st=e.st||'09:00',en=e.en||'10:00';b.start.dateTime=new Date(date+'T'+st+':00').toISOString();let end=new Date(date+'T'+en+':00');if(end<=new Date(date+'T'+st+':00'))end.setDate(end.getDate()+1);b.end.dateTime=end.toISOString();}
    return b;
  }
  async function pushEvent(e){if(!e.syncDirty||!e.syncSource)return;
    if(e.syncConflict)throw Error(`Conflict for "${e.t}". Resolve in the original calendar before retrying.`);
    if(e.syncSource==='google'){
      if(!sessions.has(e.syncAccount))throw Error(`Connect ${e.syncAccount} again to upload "${e.t}".`);
      const target=`/calendars/${qs(e.syncCalendar)}/events`;
      // Conditional update protects remote changes that happened since our last pull.
      const headers=e.syncId&&e.syncEtag?{'If-Match':e.syncEtag}:{};
      const response=await gapi(e.syncAccount,target+(e.syncId?'/'+qs(e.syncId):''),{method:e.syncId?'PATCH':'POST',headers,body:JSON.stringify(getRemoteBody(e))});
      e.syncId=response.id;e.syncEtag=response.etag||'';e.syncManaged=true;
    }else if(e.syncSource==='icloud'){
      if(!e.syncManaged&&e.syncId)throw Error('Existing iCloud events can only be edited in Apple Calendar.');
      const gbody=getRemoteBody(e);const body={calendar:e.syncCalendar,href:e.syncId||'',etag:e.syncEtag||'',event:{title:e.t,description:e.n,date:e.date,allDay:!!e.ad,start:e.st,end:e.en,startIso:gbody.start.dateTime||null,endIso:gbody.end.dateTime||null}};
      const r=await icRequest('/events',e.syncId?'PUT':'POST',body);e.syncId=r.id;e.syncEtag=r.etag||'';e.syncManaged=true;
    }
    e.syncDirty=false;e.syncConflict=false;save();
  }
  async function pushAll(){let count=0;for(const e of S.ev.filter(e=>e.syncDirty&&e.syncSource)){try{await pushEvent(e);count++;}catch(err){cfg.lastError=String(err.message);save();}}
    const outstanding=[];for(const d of S.syncDeletes||[]){try{if(d.source==='google')await gapi(d.account,`/calendars/${qs(d.calendar)}/events/${qs(d.id)}`,{method:'DELETE',headers:d.etag?{'If-Match':d.etag}:{}});
        else if(d.source==='icloud')await icRequest('/events','DELETE',{href:d.id,etag:d.etag});count++;
      }catch(err){if(/404|410/.test(String(err)))continue;outstanding.push(d);cfg.lastError=String(err.message);}}
    S.syncDeletes=outstanding;save();return count;
  }
  async function syncAll(pushOnly=false,provider='all'){
    if(syncing)return;syncing=true;cfg.lastError='';let n=0;
    try{n+=await pushAll();if(!pushOnly){if(provider!=='icloud')n+=await pullGoogle();if(provider!=='google'&&appleSessionToken)n+=await pullIcloud();}cfg.lastSync=new Date().toISOString();save();if(V==='set'||V==='cal'||V==='home')render();toast(`Calendar sync completed (${n} items processed).`);
    }catch(e){cfg.lastError=e.message||String(e);save();toast(`Calendar sync issue: ${cfg.lastError}`);}
    finally{syncing=false;}
  }
  // Settings action handlers connect through the original delegated action router.
  A.gconnect=()=>connectGoogle();A.grefresh=()=>bridgeGoogleRefresh();A.gsync=()=>syncAll(false,'google');A.icconnect=()=>connectIcloud();A.icsync=()=>syncAll(false,'icloud');A.syncall=()=>syncAll(false,'all');
  document.addEventListener('change',e=>{const t=e.target;
    const iG=t.dataset.gEnable, cG=t.dataset.gCategory, iI=t.dataset.icEnable,cI=t.dataset.icCategory;
    if(iG!==undefined){cfg.googleSources[Number(iG)].enabled=t.checked;save();}
    if(cG!==undefined){const c=cfg.googleSources[Number(cG)];c.category=t.value;applyCalendarCategory('google',c.email,c);render();}
    if(iI!==undefined){cfg.icloudSources[Number(iI)].enabled=t.checked;save();}
    if(cI!==undefined){const c=cfg.icloudSources[Number(cI)];c.category=t.value;applyCalendarCategory('icloud','icloud',c);render();}
    if(t.id==='g-client'){cfg.clientId=t.value.trim();save();}
    if(t.id==='g-mode'){cfg.googleMode=t.value;sessions.clear();pendingGoogleURL='';save();render();}
    if(t.id==='ic-url'){cfg.icloudUrl=t.value.trim();save();}
  });
  // App-open sync: private iCloud bridge token must be supplied per session; Google sessions are short-lived.
  setInterval(()=>{if([...sessions.keys()].length||appleSessionToken)syncAll(false,'all');},10*60*1000);
  if(V==='set')render();
})();
