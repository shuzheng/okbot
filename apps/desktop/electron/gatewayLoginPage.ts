/**
 * Browser entry for the desktop gateway.
 * Programmatic `/v1/*` routes stay JSON; a person opening the gateway URL gets this form.
 */
export function shouldServeGatewayLogin(method: string, pathname: string, authed: boolean): boolean {
  if (method !== 'GET') return false;
  if (pathname === '/gateway-login' || pathname === '/gateway-login.html') return true;
  return pathname === '/' && !authed;
}

export function gatewayLoginHtml(errorMessage = ''): string {
  const err = errorMessage
    ? `<p style="color:#f87171">${errorMessage.replace(/</g, '&lt;')}</p>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>OkBot Gateway</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;max-width:420px;margin:auto;background:#111;color:#eee}input,button{font-size:16px;width:100%;box-sizing:border-box;padding:12px;margin:8px 0;border-radius:8px;border:1px solid #444;background:#222;color:#fff}button{background:#3b82f6;border:none;font-weight:600}p{line-height:1.45;color:#ccc}</style></head><body>
<h1>OkBot</h1>
<p>输入桌面「设置 → 网关服务」里的访问令牌，即可在这台设备上打开 OkBot。</p>
<p>Enter the access token from Settings → Gateway service.</p>
<p style="font-size:12px;opacity:.75">持有令牌的人等同于这台电脑上的你：能聊天、批准工具（包括运行命令和改文件），能改助手的人设、记忆和技能。只在自己的设备上输入。<br/>Anyone with the token acts as you on this computer: chat, approve tools (including commands and file edits), and change assistant personas, memories and skills. Enter it only on your own devices.</p>
${err}
<form method="POST" action="/gateway-login">
<input name="token" id="t" type="password" placeholder="访问令牌 / Access token" autocomplete="current-password" required/>
<button type="submit">打开 OkBot</button>
</form>
</body></html>`;
}

/** Methods the desktop preload exposes, plus the legacy onChatEvent alias. */
export const GATEWAY_BRIDGE_METHOD_NAMES = [
  'getBootstrap',
  'listBots',
  'createBot',
  'updateBot',
  'finishBotOnboarding',
  'deleteBot',
  'listSquads',
  'createSquad',
  'updateSquad',
  'deleteSquad',
  'readAgentsMd',
  'writeAgentsMd',
  'listBotMemories',
  'upsertBotMemory',
  'deleteBotMemory',
  'listGlobalMemories',
  'upsertGlobalMemory',
  'deleteGlobalMemory',
  'listBotSkills',
  'writeBotSkill',
  'deleteBotSkill',
  'listGlobalAgentsSkills',
  'exportAssistantPackage',
  'importAssistantPackage',
  'listAssistantGallery',
  'installGalleryAssistant',
  'mcpStatus',
  'mcpTestServer',
  'backupExport',
  'backupRestore',
  'getSettings',
  'getGatewayAccessToken',
  'saveSettings',
  'discoverModels',
  'testModelConnection',
  'probeComputer',
  'getMessages',
  'getMessagesPage',
  'searchMessages',
  'getPromptContext',
  'getLastRunTrace',
  'chatStart',
  'chatStartSquad',
  'chatAbort',
  'compressSessionNow',
  'setChatUnread',
  'toolRespond',
  'copyText',
  'pickPaths',
  'getPathForFile',
  'listScheduledJobs',
  'manageScheduledJob',
  'readGeneratedAssetDataUrl',
  'setTrafficLightPosition',
  'windowMinimize',
  'windowMaximizeToggle',
  'windowClose',
  'windowIsMaximized',
  'windowFocus',
  'claimNotification',
  'onWindowMaximizedChanged',
  'ensureMicrophoneAccess',
  'openMicrophoneSettings',
  'getAppInfo',
  'getRecentErrorLog',
  'clearModelBindingsForProvider',
  'getUsageStats',
  'updaterGetStatus',
  'updaterCheck',
  'updaterDownload',
  'updaterInstall',
  'onRuntimeEvent',
  'onUpdaterEvent',
  'onNativeThemeUpdated',
  'onChatEvent',
] as const;

const GATEWAY_EVENT_METHODS = new Set([
  'onChatEvent',
  'onRuntimeEvent',
  'onUpdaterEvent',
  'onNativeThemeUpdated',
  'onWindowMaximizedChanged',
]);

/**
 * Runs before the renderer bundle.
 * `electron-vite dev` rebuilds main/preload but leaves `out/renderer` untouched, so the
 * gateway can still be serving a pre-bridge bundle that calls `window.okbot.getAppInfo`
 * at module init and never assigns `window.okbot` itself. The bridge therefore has to
 * exist before that script. A newer bundle may replace it; the setter keeps any real
 * method and only fills names that are still missing.
 */
export function gatewayBootJs(): string {
  const names = JSON.stringify([...GATEWAY_BRIDGE_METHOD_NAMES]);
  const events = JSON.stringify([...GATEWAY_EVENT_METHODS]);
  return `(function(){
  var names=${names};
  var events=${events};
  function noopUnsubscribe(){return function(){};}
  function gatewayToken(){
    try{
      var attach=globalThis.__okbotAttach;
      if(attach && typeof attach.token==='string' && attach.token.trim()) return attach.token.trim();
    }catch(e){}
    return '';
  }
  function api(method, path, body){
    var token=gatewayToken();
    var headers={Accept:'application/json'};
    if(token) headers.Authorization='Bearer '+token;
    var init={method:method, headers:headers, credentials:'include'};
    if(body!==undefined){ headers['Content-Type']='application/json'; init.body=JSON.stringify(body); }
    return fetch(path, init).then(function(res){
      return res.text().then(function(text){
        var json=null;
        try{ json=text.trim()?JSON.parse(text):null; }catch(e){ throw new Error('Gateway non-JSON ('+res.status+'): '+text.slice(0,160)); }
        if(!res.ok) throw new Error((json&&json.error)||('HTTP '+res.status));
        return json;
      });
    });
  }
  var runtimeListeners=[];
  function addListener(cb){
    runtimeListeners.push(cb);
    return function(){
      var i=runtimeListeners.indexOf(cb);
      if(i>=0) runtimeListeners.splice(i,1);
    };
  }
  function emit(event){
    var list=runtimeListeners.slice();
    for(var i=0;i<list.length;i++){ try{ list[i](event); }catch(e){} }
  }
  function readSse(res){
    if(!res.ok||!res.body){
      return res.text().then(function(t){ throw new Error(t||('HTTP '+res.status)); });
    }
    var reader=res.body.getReader();
    var decoder=new TextDecoder();
    var buf='';
    function pump(){
      return reader.read().then(function(step){
        if(step.done) return {ok:true};
        buf+=decoder.decode(step.value,{stream:true});
        var parts=buf.split('\\n\\n');
        buf=parts.pop()||'';
        for(var p=0;p<parts.length;p++){
          var lines=parts[p].split('\\n');
          var data='';
          for(var l=0;l<lines.length;l++){ if(lines[l].indexOf('data:')===0) data+=lines[l].slice(5).trim(); }
          if(!data) continue;
          try{ emit(JSON.parse(data)); }catch(e){}
        }
        return pump();
      });
    }
    return pump();
  }
  function postChat(path, body){
    var token=gatewayToken();
    var headers={Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'text/event-stream'};
    if(!token) delete headers.Authorization;
    return fetch(path,{
      method:'POST',
      headers:headers,
      credentials:'include',
      body:JSON.stringify(body)
    }).then(readSse);
  }
  function unsupported(message){
    return function(){ return Promise.reject(new Error(message)); };
  }
  // Sept 30 SessionSidebar maps squad.members; SettingsModal maps tools[id].enabled
  // and model.models[].enabled. Missing arrays/objects crash that bundle.
  function fillTools(tools){
    var ids=['read_file','read_skill','write_file','edit_file','run_shell','generate_image'];
    var src=tools&&typeof tools==='object'?tools:{};
    var out={};
    for(var i=0;i<ids.length;i++){
      var id=ids[i];
      var item=src[id];
      var ok=!!(item&&typeof item==='object');
      out[id]={
        enabled:!ok||item.enabled!==false,
        approval:ok&&item.approval==='allow'?'allow':'ask'
      };
    }
    return out;
  }
  function fillModel(model){
    var m=model&&typeof model==='object'?model:{};
    var providers=Array.isArray(m.providers)?m.providers:[];
    var next=[];
    for(var i=0;i<providers.length;i++){
      var p=providers[i]||{};
      var models=Array.isArray(p.models)?p.models:[];
      var ms=[];
      for(var j=0;j<models.length;j++){
        var x=models[j]||{};
        var row={
          id:x.id||'',
          name:x.name||x.id||'',
          contextWindow:x.contextWindow,
          maxTokens:x.maxTokens,
          enabled:x.enabled!==false
        };
        if(x.showThinking===false) row.showThinking=false;
        ms.push(row);
      }
      next.push({
        id:p.id||'',
        name:p.name||'',
        baseURL:p.baseURL||'',
        apiKey:typeof p.apiKey==='string'?p.apiKey:'',
        apiFormat:p.apiFormat||'chat_completions',
        models:ms
      });
    }
    return {providers:next, defaultProviderId:m.defaultProviderId||'', defaultModelId:m.defaultModelId||''};
  }
  function fillSquad(s){
    var src=s&&typeof s==='object'?s:{};
    var members=Array.isArray(src.members)?src.members:[];
    var next=[];
    for(var i=0;i<members.length;i++){
      var m=members[i]||{};
      next.push({botId:m.botId||'', role:typeof m.role==='string'?m.role:''});
    }
    var out={};
    for(var k in src){ if(Object.prototype.hasOwnProperty.call(src,k)) out[k]=src[k]; }
    out.members=next;
    out.id=src.id||'';
    out.name=typeof src.name==='string'?src.name:'';
    return out;
  }
  function fillSettings(settings){
    var s=settings&&typeof settings==='object'?settings:{};
    var security=s.security&&typeof s.security==='object'?s.security:{};
    var local=s.localHttpApi&&typeof s.localHttpApi==='object'?s.localHttpApi:{};
    var out={};
    for(var k in s){ if(Object.prototype.hasOwnProperty.call(s,k)) out[k]=s[k]; }
    out.theme=s.theme||'system';
    out.language=s.language||'system';
    out.computers=Array.isArray(s.computers)?s.computers:[];
    out.tools=fillTools(s.tools);
    out.security={
      enabled:security.enabled!==false,
      restrictToHome:security.restrictToHome===true,
      allowedPathPrefixes:Array.isArray(security.allowedPathPrefixes)?security.allowedPathPrefixes:[],
      deniedPathPrefixes:Array.isArray(security.deniedPathPrefixes)?security.deniedPathPrefixes:[],
      shellPatternsEnabled:security.shellPatternsEnabled!==false,
      blockMode:security.blockMode==='tripwire'?'tripwire':'reject'
    };
    out.model=fillModel(s.model);
    out.autoApprovalEnabled=s.autoApprovalEnabled===true;
    out.autoApprovalRules=Array.isArray(s.autoApprovalRules)?s.autoApprovalRules:[];
    out.microphoneId=typeof s.microphoneId==='string'?s.microphoneId:'';
    out.localHttpApi={
      enabled:local.enabled===true,
      port:typeof local.port==='number'?local.port:18765,
      token:typeof local.token==='string'?local.token:'',
      bindLan:local.bindLan===true,
      serveUi:local.serveUi===true
    };
    if(!out.contextCompression||typeof out.contextCompression!=='object') out.contextCompression={};
    if(!out.instructions||typeof out.instructions!=='object') out.instructions={};
    if(!out.memory||typeof out.memory!=='object') out.memory={};
    if(!out.squad||typeof out.squad!=='object') out.squad={};
    if(!out.toolRun||typeof out.toolRun!=='object') out.toolRun={};
    return out;
  }
  function createBridge(){
    var okbot={
      getBootstrap:function(){
        return api('GET','/v1/bootstrap').then(function(b){
          b=b||{};
          var runs=b.activeRuns&&typeof b.activeRuns==='object'?b.activeRuns:{};
          var bots=Array.isArray(b.bots)?b.bots:[];
          var squads=Array.isArray(b.squads)?b.squads:[];
          var busy=Array.isArray(b.busyBotIds)?b.busyBotIds:(Array.isArray(runs.busyBotIds)?runs.busyBotIds:[]);
          var pending=Array.isArray(b.pendingToolRequests)?b.pendingToolRequests:(Array.isArray(runs.pendingToolRequests)?runs.pendingToolRequests:[]);
          var settings=fillSettings(b.settings);
          return api('GET','/v1/gateway-token').then(function(tok){
            var token=tok&&typeof tok.token==='string'?tok.token:'';
            if(token){
              var local=settings.localHttpApi&&typeof settings.localHttpApi==='object'?settings.localHttpApi:{};
              settings=Object.assign({}, settings, {localHttpApi:Object.assign({}, local, {token:token})});
            }
            return {
              bots:bots,
              squads:squads.map(fillSquad),
              dataDir:b.dataDir||'',
              hardwareAccelerationActive:b.hardwareAccelerationActive!==false,
              settings:settings,
              busyBotIds:busy,
              pendingToolRequests:pending,
              activeRuns:{busyBotIds:busy, pendingToolRequests:pending}
            };
          }, function(){
            return {
              bots:bots,
              squads:squads.map(fillSquad),
              dataDir:b.dataDir||'',
              hardwareAccelerationActive:b.hardwareAccelerationActive!==false,
              settings:settings,
              busyBotIds:busy,
              pendingToolRequests:pending,
              activeRuns:{busyBotIds:busy, pendingToolRequests:pending}
            };
          });
        });
      },
      listBots:function(){ return api('GET','/v1/bots').then(function(r){ return (r&&r.bots)||[]; }); },
      listSquads:function(){ return api('GET','/v1/squads').then(function(r){ return ((r&&r.squads)||[]).map(fillSquad); }); },
      getSettings:function(){ return okbot.getBootstrap().then(function(b){ return b.settings; }); },
      getGatewayAccessToken:function(){
        return api('GET','/v1/gateway-token').then(function(json){
          return json&&typeof json.token==='string'?json.token:'';
        }, function(){ return ''; });
      },
      saveSettings:function(settings){
        return api('POST','/v1/settings', settings).then(function(json){
          var filled=fillSettings((json&&json.settings)||json);
          return api('GET','/v1/gateway-token').then(function(tok){
            var token=tok&&typeof tok.token==='string'?tok.token:'';
            if(!token) return filled;
            var local=filled.localHttpApi&&typeof filled.localHttpApi==='object'?filled.localHttpApi:{};
            return Object.assign({}, filled, {localHttpApi:Object.assign({}, local, {token:token})});
          }, function(){ return filled; });
        });
      },
      getMessagesPage:function(ownerId, opts){
        var q=new URLSearchParams();
        if(opts&&opts.limit) q.set('limit', String(opts.limit));
        if(opts&&opts.beforeMessageId) q.set('beforeMessageId', opts.beforeMessageId);
        var suffix=q.toString()?('?'+q.toString()):'';
        return api('GET','/v1/bots/'+encodeURIComponent(ownerId)+'/messages'+suffix).catch(function(){
          return api('GET','/v1/squads/'+encodeURIComponent(ownerId)+'/messages'+suffix);
        });
      },
      getMessages:function(botId, opts){
        var limit=50;
        if(opts&&typeof opts.limit==='number'&&opts.limit>0) limit=Math.min(200, Math.max(1, Math.floor(opts.limit)));
        return okbot.getMessagesPage(botId,{limit:limit}).then(function(page){ return (page&&page.messages)||[]; });
      },
      chatStart:function(botId, text, opts){
        return postChat('/v1/bots/'+encodeURIComponent(botId)+'/messages',{
          text:text,
          computerId:opts&&opts.computerId,
          quoteMessageId:opts&&opts.quoteMessageId,
          attachments:opts&&opts.attachments
        });
      },
      chatStartSquad:function(squadId, text, opts){
        return postChat('/v1/squads/'+encodeURIComponent(squadId)+'/messages',{
          text:text,
          computerId:opts&&opts.computerId,
          quoteMessageId:opts&&opts.quoteMessageId
        });
      },
      chatAbort:function(ownerId){
        var id=String(ownerId||'').trim();
        if(!id) return Promise.resolve({ok:false, error:'missing_id'});
        return api('POST','/v1/bots/'+encodeURIComponent(id)+'/abort').catch(function(err){
          var message=err&&err.message?String(err.message):'';
          if(message!=='bot_not_found') return {ok:false, error:message||'abort_failed'};
          return api('POST','/v1/squads/'+encodeURIComponent(id)+'/abort');
        });
      },
      onRuntimeEvent:addListener,
      onChatEvent:addListener,
      copyText:function(text){
        try{
          if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function(){return true;}, function(){return false;});
        }catch(e){}
        return Promise.resolve(false);
      },
      getAppInfo:function(){
        var platform='web';
        try{
          var attach=globalThis.__okbotAttach;
          if(attach && typeof attach.platform==='string' && attach.platform) platform=attach.platform;
        }catch(e){}
        var fallback={name:'OkBot', version:'0.0.0', platform:platform, arch:'', electron:'', chrome:'', buildDate:''};
        try{
          return api('GET','/v1/app-info').then(function(info){
            info=info||{};
            return {
              name:typeof info.name==='string'&&info.name?info.name:'OkBot',
              version:typeof info.version==='string'&&info.version?info.version:'0.0.0',
              platform:typeof info.platform==='string'&&info.platform?info.platform:platform,
              arch:typeof info.arch==='string'?info.arch:'',
              electron:'',
              chrome:'',
              buildDate:''
            };
          }, function(){ return fallback; });
        }catch(e){
          return Promise.resolve(fallback);
        }
      },
      setTrafficLightPosition:function(){ return Promise.resolve(false); },
      probeComputer:function(){ return Promise.resolve({ok:false, error:'unreachable'}); },
      toolRespond:function(payload){
        var body=payload&&typeof payload==='object'?payload:{};
        return api('POST','/v1/tool-respond',{
          requestId:typeof body.requestId==='string'?body.requestId:'',
          approved:body.approved===true,
          message:typeof body.message==='string'?body.message:undefined
        }).catch(function(err){
          return {ok:false, error:(err&&err.message)||'tool_respond_failed'};
        });
      },
      setChatUnread:function(){ return Promise.resolve(true); },
      updaterGetStatus:function(){
        return okbot.getAppInfo().then(function(info){
          return {phase:'idle', currentVersion:(info&&info.version)||'0.0.0'};
        }, function(){ return {phase:'idle', currentVersion:'0.0.0'}; });
      },
      onUpdaterEvent:noopUnsubscribe,
      onNativeThemeUpdated:noopUnsubscribe,
      windowMinimize:function(){ return Promise.resolve(false); },
      windowMaximizeToggle:function(){ return Promise.resolve(false); },
      windowClose:function(){ return Promise.resolve(false); },
      windowIsMaximized:function(){ return Promise.resolve(false); },
      onWindowMaximizedChanged:noopUnsubscribe,
      ensureMicrophoneAccess:function(){ return Promise.resolve({granted:false, status:'unknown', prompted:false}); },
      openMicrophoneSettings:function(){ return Promise.resolve(false); },
      getUsageStats:function(){
        var empty={lifetime:{input:0,output:0,cache:0},daily:{},byOwner:{},dailyByOwner:{}};
        function bag(v){ var u=v&&typeof v==='object'&&!Array.isArray(v)?v:{}; return {input:Number(u.input)||0,output:Number(u.output)||0,cache:Number(u.cache)||0}; }
        function map(v){
          if(!v||typeof v!=='object'||Array.isArray(v)) return {};
          var out={};
          for(var k in v){
            if(!Object.prototype.hasOwnProperty.call(v,k)) continue;
            var u=v[k];
            out[k]=u&&typeof u==='object'&&!Array.isArray(u)?{input:Number(u.input)||0,output:Number(u.output)||0,cache:Number(u.cache)||0}:{input:0,output:0,cache:0};
          }
          return out;
        }
        return api('GET','/v1/usage').then(function(body){
          var src=body&&typeof body==='object'?body:{};
          var dailyByOwner={};
          var raw=src.dailyByOwner;
          if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
            for(var id in raw){
              if(Object.prototype.hasOwnProperty.call(raw,id)) dailyByOwner[id]=map(raw[id]);
            }
          }
          return {lifetime:bag(src.lifetime),daily:map(src.daily),byOwner:map(src.byOwner),dailyByOwner:dailyByOwner};
        }, function(){ return empty; });
      },
      pickPaths:function(){ return Promise.resolve({canceled:true, paths:[]}); },
      getPathForFile:function(){ return ''; },
      listScheduledJobs:function(){ return Promise.resolve([]); },
      manageScheduledJob:function(){ return Promise.resolve({ok:true, summary:''}); },
      readGeneratedAssetDataUrl:function(){ return Promise.resolve(null); },
      getPromptContext:function(){ return Promise.resolve({text:null}); },
      getLastRunTrace:function(){ return Promise.resolve(null); },
      searchMessages:function(){ return Promise.resolve([]); },
      listBotMemories:function(){ return Promise.resolve([]); },
      listGlobalMemories:function(){ return Promise.resolve([]); },
      listBotSkills:function(){ return Promise.resolve([]); },
      listGlobalAgentsSkills:function(){ return Promise.resolve([]); },
      readAgentsMd:function(){ return Promise.resolve(''); },
      createBot:unsupported('Create bot from gateway not supported yet'),
      createSquad:unsupported('Create squad from gateway not supported yet'),
      updateBot:unsupported('Update bot from gateway not supported yet'),
      finishBotOnboarding:unsupported('Bot onboarding from gateway not supported yet'),
      deleteBot:unsupported('Delete bot from gateway not supported yet'),
      updateSquad:unsupported('Update squad from gateway not supported yet'),
      deleteSquad:unsupported('Delete squad from gateway not supported yet'),
      writeAgentsMd:function(){ return Promise.resolve(true); },
      upsertBotMemory:function(){ return Promise.resolve(true); },
      deleteBotMemory:function(){ return Promise.resolve(true); },
      upsertGlobalMemory:function(){ return Promise.resolve(true); },
      deleteGlobalMemory:function(){ return Promise.resolve(true); },
      writeBotSkill:function(){ return Promise.resolve(true); },
      deleteBotSkill:function(){ return Promise.resolve(true); },
      exportAssistantPackage:function(){ return Promise.resolve({canceled:true}); },
      importAssistantPackage:function(){ return Promise.resolve({canceled:true}); },
      discoverModels:function(){ return Promise.resolve({ok:false, error:'not_supported_on_gateway'}); },
      testModelConnection:function(){ return Promise.resolve({ok:false, error:'not_supported_on_gateway'}); },
      clearModelBindingsForProvider:function(){ return Promise.resolve({cleared:0}); },
      getRecentErrorLog:function(){ return Promise.resolve({entries:[]}); },
      updaterCheck:function(){ return okbot.updaterGetStatus(); },
      updaterDownload:function(){ return okbot.updaterGetStatus(); },
      updaterInstall:function(){ return Promise.resolve(undefined); },
      compressSessionNow:function(){ return Promise.resolve({ok:false, error:'not_supported_on_gateway'}); }
    };
    return okbot;
  }
  function fallbackCall(){
    return Promise.resolve({
      ok:false, error:'not_supported_on_gateway', canceled:true, paths:[], entries:[],
      bots:[], squads:[], messages:[], computers:[], byOwner:[], daily:[], text:null,
      platform:'web', name:'OkBot Gateway', version:'gateway', arch:'', electron:'', chrome:'', buildDate:'',
      state:'idle', granted:false, status:'unknown',
      settings:{theme:'system', language:'system', computers:[], tools:{read_file:{enabled:true,approval:'allow'},read_skill:{enabled:true,approval:'allow'},write_file:{enabled:true,approval:'allow'},edit_file:{enabled:true,approval:'allow'},run_shell:{enabled:true,approval:'allow'},generate_image:{enabled:true,approval:'allow'}}, security:{enabled:true,allowedPathPrefixes:[],deniedPathPrefixes:[]}, model:{providers:[], defaultProviderId:'', defaultModelId:''}, autoApprovalRules:[]},
      busyBotIds:[], pendingToolRequests:[], activeRuns:{busyBotIds:[], pendingToolRequests:[]}, hardwareAccelerationActive:false, dataDir:''
    });
  }
  var stubs={};
  for(var i=0;i<names.length;i++){
    stubs[names[i]] = events.indexOf(names[i])>=0 ? noopUnsubscribe : fallbackCall;
  }
  function fill(obj){
    if(!obj||typeof obj!=='object') return obj;
    for(var k in stubs){ if(typeof obj[k]!=='function') obj[k]=stubs[k]; }
    return obj;
  }
  var current=createBridge();
  try{ document.documentElement.dataset.okbotGateway='1'; }catch(e){}
  try{ Object.defineProperty(window,'__okbotGatewayBoot',{value:true,configurable:true}); }catch(e){}
  try{
    Object.defineProperty(window,'okbot',{
      configurable:true,
      enumerable:true,
      get:function(){return current;},
      set:function(v){ current=fill(v); }
    });
  }catch(e){
    try{ window.okbot=current; }catch(e2){}
  }
})();
`;
}

/** Classic script in <head> runs before the deferred renderer module. */
export function injectGatewayBoot(html: string): string {
  const tag = '<script src="/gateway-boot.js"></script>';
  if (html.includes('/gateway-boot.js')) return html;
  const m = /<head[^>]*>/i.exec(html);
  if (!m) return tag + html;
  const i = m.index + m[0].length;
  return html.slice(0, i) + tag + html.slice(i);
}
